import { Readability } from "@mozilla/readability";
import { type AppConfig, type Link, type LinkDigest, primaryArticle, type TimeRange } from "@xrss/core";
import { type Db, linkDigests, loadLinkDigests, tweets, type TweetRow } from "@xrss/core/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { parseHTML } from "linkedom";
import { articleOrigLang, type Summarizer } from "./ai.ts";
import { inBatch } from "./batch.ts";

export { primaryArticle } from "@xrss/core";

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function isSkipped(url: string, skipDomains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return true;
  return skipDomains.some((d) => host === d || host.endsWith(`.${d}`));
}

const absolute = (value: string | null | undefined, base: string) => {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
};

const clean = (s: string | null | undefined) => s?.replace(/\s+/g, " ").trim() || undefined;

/** 从 HTML 中取出标题、简介、封面和正文（Open Graph + Readability） */
export function extractArticle(html: string, url: string) {
  const { document } = parseHTML(html);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      const v = clean(el?.getAttribute("content"));
      if (v) return v;
    }
    return undefined;
  };
  const ogTitle = meta("og:title", "twitter:title");
  const description = meta("og:description", "twitter:description", "description");
  const imageUrl = absolute(meta("og:image", "og:image:url", "twitter:image", "twitter:image:src"), url);
  const siteName = meta("og:site_name", "application-name");

  let text = "";
  let readTitle: string | undefined;
  try {
    // Readability 会修改文档，放在读取 meta 之后
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    text = clean(article?.textContent) ?? "";
    readTitle = clean(article?.title);
  } catch {
    text = "";
  }
  return {
    title: ogTitle ?? readTitle ?? clean(document.querySelector("title")?.textContent),
    description,
    imageUrl,
    siteName,
    text,
  };
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
}

/** 抓取一篇文章；失败时返回 failed 状态，不抛错 */
export async function fetchArticle(url: string, opts: FetchOptions): Promise<LinkDigest> {
  const now = new Date().toISOString();
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; XRSS-LinkPreview/1.0; daily digest link preview)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml/.test(type)) throw new Error(`不是网页（${type || "未知类型"}）`);

    // 限制读取大小，避免超大页面
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > opts.maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    const finalUrl = res.url || url;
    const a = extractArticle(html, finalUrl);
    return {
      url,
      finalUrl,
      siteName: a.siteName ?? hostOf(finalUrl),
      title: a.title,
      description: a.description,
      imageUrl: a.imageUrl,
      excerpt: a.text.slice(0, 12_000) || undefined,
      textLength: a.text.length,
      status: "fetched",
      fetchedAt: now,
      points: [],
    };
  } catch (e) {
    const err = e as Error;
    return { url, status: "failed", error: err.name === "TimeoutError" ? "请求超时" : err.message.slice(0, 200), fetchedAt: now, textLength: 0, points: [] };
  }
}

/** 抓取失败时，用 X 卡片里的标题、简介和封面兜底 */
export function withCardFallback(d: LinkDigest | undefined, link: Link): LinkDigest | undefined {
  if (!d) return undefined;
  return {
    ...d,
    title: d.title ?? link.title,
    description: d.description ?? link.description,
    imageUrl: d.imageUrl ?? link.imageUrl,
    siteName: d.siteName ?? link.domain,
  };
}

/** 见 @xrss/core/db 的 loadLinkDigests */
export const loadDigests = loadLinkDigests;

export async function saveDigest(db: Db, d: LinkDigest): Promise<void> {
  await db
    .insert(linkDigests)
    .values({ url: d.url, data: d, updatedAt: new Date() })
    .onConflictDoUpdate({ target: linkDigests.url, set: { data: d, updatedAt: new Date() } });
}

/**
 * 评审前：为候选推文抓取外部文章（已缓存的跳过），并发度较低，避免对同一站点造成压力。
 * 返回 推文 ID → 文章 的映射，供初审参考文章内容。
 */
export async function fetchCandidateArticles(
  db: Db,
  config: AppConfig,
  rows: TweetRow[],
  opts: { fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<{ byTweet: Map<string, LinkDigest>; fetched: number; failed: number }> {
  const cfg = config.digest.links;
  const targets = new Map<string, { tweetIds: string[]; link: Link }>();
  for (const row of rows) {
    const p = primaryArticle(row.raw);
    if (!p) continue;
    const t = targets.get(p.link.expandedUrl) ?? { tweetIds: [], link: p.link };
    t.tweetIds.push(row.id);
    targets.set(p.link.expandedUrl, t);
  }

  const cache = await loadDigests(db, [...targets.keys()]);
  let fetched = 0;
  let failed = 0;
  // 没抓过的，或上次失败且已过去 6 小时的，才去抓
  const retryAfter = 6 * 3_600_000;
  const todo = [...targets.keys()].filter((url) => {
    const c = cache.get(url);
    return !c || (c.status === "failed" && Date.now() - new Date(c.fetchedAt).getTime() > retryAfter);
  });
  const concurrency = opts.concurrency ?? 3;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (i < todo.length) {
        const url = todo[i++]!;
        const d =
          !cfg.fetch || isSkipped(url, cfg.skip_domains)
            ? ({ url, status: "skipped", fetchedAt: new Date().toISOString(), textLength: 0, points: [] } satisfies LinkDigest)
            : await fetchArticle(url, { timeoutMs: cfg.timeout_ms, maxBytes: cfg.max_bytes, fetchImpl: opts.fetchImpl });
        if (d.status === "fetched") fetched++;
        if (d.status === "failed") failed++;
        await saveDigest(db, d);
        cache.set(url, d);
      }
    }),
  );

  const byTweet = new Map<string, LinkDigest>();
  for (const [url, t] of targets) {
    const d = withCardFallback(cache.get(url), t.link);
    if (d) for (const id of t.tweetIds) byTweet.set(id, d);
  }
  return { byTweet, fetched, failed };
}

/**
 * 通过精选后：为时间范围内进入邮件候选的推文里的文章生成中文图文摘要（已有摘要的跳过）。
 * 只有标题没有正文时也会生成，但要点会少一些。
 */
export async function summarizeArticles(
  db: Db,
  range: TimeRange,
  summarizer: Summarizer,
  opts: { concurrency?: number } = {},
): Promise<{ summarized: number; failed: Array<{ url: string; error: string }> }> {
  const rows = await db
    .select()
    .from(tweets)
    .where(and(eq(tweets.status, "scored"), inBatch(range)));
  const wanted = new Map<string, { link: Link; tweetText: string; lang?: string }>();
  for (const row of rows) {
    const p = primaryArticle(row.raw);
    if (!p) continue;
    const prev = wanted.get(p.link.expandedUrl);
    // 同一篇文章被多条推文分享时，有一条不是中文就要原文版概要：优先用那条推文的语言
    if (!prev || (articleOrigLang(prev.lang) === null && articleOrigLang(row.raw.lang) !== null)) {
      wanted.set(p.link.expandedUrl, { link: p.link, tweetText: [row.raw.text, row.raw.quoted?.text].filter(Boolean).join("\n"), lang: row.raw.lang });
    }
  }
  const cache = await loadDigests(db, [...wanted.keys()]);
  const todo = [...wanted.entries()].filter(([url, w]) => {
    const d = cache.get(url);
    // 以前只生成过中文概要、现在又被外文推文分享的，补上原文版概要
    return d && d.status !== "skipped" && (!d.summarizedAt || (!d.orig && articleOrigLang(w.lang) !== null));
  });

  const result = { summarized: 0, failed: [] as Array<{ url: string; error: string }> };
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 3, todo.length) }, async () => {
      while (i < todo.length) {
        const [url, { link, tweetText, lang }] = todo[i++]!;
        const base = withCardFallback(cache.get(url), link)!;
        if (!base.title && !base.excerpt && !base.description) continue;
        try {
          const s = await summarizer.summarize(base, { tweetText, lang });
          await saveDigest(db, { ...cache.get(url)!, titleZh: s.titleZh, summary: s.summary, points: s.points, orig: s.orig, summarizedAt: new Date().toISOString() });
          result.summarized++;
        } catch (e) {
          result.failed.push({ url, error: (e as Error).message });
        }
      }
    }),
  );
  return result;
}
