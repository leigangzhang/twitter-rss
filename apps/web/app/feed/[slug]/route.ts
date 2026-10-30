import {
  type ArticleView,
  type CardView,
  type Lang,
  effectiveTopicId,
  localDate,
  primaryArticle,
  qualityOf,
  resolveTopicId,
  selectFeedIssues,
  startOfLocalDay,
  toCardView,
} from "@xrss/core";
import { deliveries, linkDigests, recordFeedHit, tweets } from "@xrss/core/db";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { Feed } from "feed";
import { clientIp } from "@/lib/rate-limit";
import { config, db, siteUrl } from "@/lib/server";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function articleHtml(a: ArticleView): string {
  const img = a.imageUrl ? `<p><a href="${esc(a.url)}"><img src="${esc(a.imageUrl)}" alt="${esc(a.title)}"></a></p>` : "";
  const points = a.points.length ? `<ul>${a.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  return `${img}<p><strong><a href="${esc(a.url)}">${esc(a.title)}</a></strong>${a.originalTitle ? `<br><small>${esc(a.originalTitle)}</small>` : ""}${a.site ? `<br><small>${esc(a.site)}</small>` : ""}</p>${a.summary ? `<p>${esc(a.summary)}</p>` : ""}${points}<p><a href="${esc(a.url)}">阅读原文 ↗</a>${a.aiSummary ? " <small>（摘要由 AI 生成）</small>" : ""}</p>`;
}

/** RSS 条目正文：与邮件卡片同样的内容，用简单 HTML 呈现 */
function cardHtml(c: CardView): string {
  const total = c.parts.length + c.moreParts;
  const more = c.truncated ? `…</p><p><a href="${esc(c.url)}">全文较长，在 X（原 Twitter）上阅读全文</a>` : "";
  const parts =
    c.parts.length === 1
      ? `<p>${esc(c.parts[0]!).replace(/\n/g, "<br>")}${more}</p>`
      : c.parts.map((p, i) => `<p><small>${i + 1}/${total}</small> ${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const images = c.images.map((img) => `<p><a href="${esc(img.href)}"><img src="${esc(img.url)}" alt="${esc(img.alt ?? "")}"></a></p>`).join("");
  const video = c.video
    ? `<p>${c.video.thumbUrl ? `<a href="${esc(c.url)}"><img src="${esc(c.video.thumbUrl)}" alt="视频封面"></a><br>` : ""}▶ 视频${c.video.duration ? ` · ${esc(c.video.duration)}` : ""} · <a href="${esc(c.url)}">在 X 上播放</a></p>`
    : "";
  const quoted = c.quoted
    ? `<blockquote><strong>${esc(c.quoted.name)}</strong> <a href="${esc(c.quoted.url)}">@${esc(c.quoted.handle)}</a><br>${c.quoted.summary ? `${esc(c.quoted.summary)}${c.quoted.points?.length ? `<ul>${c.quoted.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}` : `${esc(c.quoted.text)}${c.quoted.truncated ? "……" : ""}`}${c.quoted.article ? articleHtml(c.quoted.article) : ""}</blockquote>`
    : "";
  const linkTitle = c.link?.title ?? (c.link?.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : undefined);
  const link = c.link && linkTitle ? `<p>🔗 <a href="${esc(c.link.url)}">${esc(linkTitle)}</a>${c.link.description ? `<br>${esc(c.link.description)}` : ""}</p>` : "";
  const meta = `<p><small>${c.categoryLabel ? `【${c.categoryLabel}】` : ""}@${esc(c.author.handle)} · ${esc(c.time)}${c.translatedFrom ? ` · ${c.translatedFrom}` : ""} · ♡ ${c.likes} · ⇄ ${c.reposts} · <a href="${esc(c.url)}">${c.ctaLabel}</a></small></p>`;
  return parts + images + video + quoted + (c.article ? articleHtml(c.article) : link) + meta;
}

/**
 * 条目标题：AI 起的标题；旧数据没有标题时，中文版用一句话摘要，都没有再用"作者：正文开头"。
 * 作者在条目的 author 里，阅读器会单独显示，标题里不再重复。
 */
function itemTitle(c: CardView): string {
  const ai = c.title ?? c.summary;
  if (ai) return ai;
  const first = c.parts[0] ?? "";
  return `${c.author.name}：${first.length > 60 ? `${first.slice(0, 60)}…` : first}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const match = /^([a-z][a-z0-9-]*)\.(zh|orig)\.xml$/.exec(slug);
  const cfg = config();
  const topicId = match ? resolveTopicId(cfg, match[1]) : undefined;
  const topic = topicId ? cfg.topics.find((t) => t.id === topicId) : undefined;
  if (!match || !topic) return new Response("未找到这个 Feed", { status: 404 });
  // 主题合并前的旧地址：永久跳转到新主题的 Feed
  if (topic.id !== match[1]) return Response.redirect(siteUrl(`/feed/${topic.id}.${match[2]}.xml`), 301);
  const lang = match[2] as Lang;

  // 记一次抓取（后台 RSS 订阅统计）；记录失败不影响输出
  const h = req.headers;
  const ip = clientIp(req);
  void db()
    .then((d) => recordFeedHit(d, { date: localDate(new Date(), cfg.digest.timezone), slug, ip, userAgent: h.get("user-agent") ?? "" }))
    .catch((e) => console.error(`[feed] 记录抓取失败：${(e as Error).message}`));

  // 选稿和邮件一致：按期（运行日期）分组，每期按"只订阅这个主题"的邮件选稿，期内按综合分排序。
  // 先只取打分需要的列，选定后再取全文
  const { timezone, send_time: sendTime } = cfg.digest;
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const d = await db();
  const pool = (
    await d
      .select({ id: tweets.id, topicId: tweets.topicId, handle: tweets.handle, ai: tweets.ai, finalScore: tweets.finalScore, batchDate: tweets.batchDate, createdAt: tweets.createdAt })
      .from(tweets)
      .where(
        and(
          eq(tweets.status, "scored"),
          or(inArray(tweets.topicId, [topic.id, ...topic.aliases]), inArray(tweets.handle, topic.accounts)),
          or(gte(tweets.batchDate, localDate(since, timezone)), and(isNull(tweets.batchDate), gte(tweets.createdAt, since))),
        ),
      )
  )
    .filter((r) => qualityOf(r.ai) >= cfg.digest.filters.min_quality)
    .map((r) => ({
      id: r.id,
      topicId: effectiveTopicId(cfg, r.topicId, r.handle) ?? "",
      finalScore: r.finalScore ?? 0,
      // 加批次之前的旧数据：按发布日期的第二天（发信那天）算
      issueDate: r.batchDate ?? localDate(new Date(r.createdAt.getTime() + 86_400_000), timezone),
    }));
  // 当天这一期要等终审去重、发出邮件后才对外可见（评审途中的推文可能还会被终审剔除）
  const today = localDate(now, timezone);
  const todaySent = pool.some((r) => r.issueDate === today)
    ? (await d.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.digestDate, today)).limit(1)).length > 0
    : false;
  const issues = selectFeedIssues(pool.filter((r) => r.issueDate < today || (r.issueDate === today && todaySent)), {
    topicId: topic.id,
    total: cfg.digest.digest.total_items,
    minPerTopic: cfg.digest.digest.min_per_topic,
    limit: cfg.digest.rss.items_per_feed,
  });
  const ids = issues.flatMap((i) => i.items.map((x) => x.id));
  const full = new Map(ids.length ? (await d.select().from(tweets).where(inArray(tweets.id, ids))).map((r) => [r.id, r]) : []);
  // 条目时间用这一期的发信时间，期内按名次每条早 1 秒：阅读器按时间排序时，顺序和邮件一样
  const [hh, mm] = sendTime.split(":").map(Number);
  const items = issues.flatMap((issue) => {
    const at = Math.min(startOfLocalDay(issue.date, timezone).getTime() + (hh! * 60 + mm!) * 60_000, now.getTime());
    return issue.items.map((x, i) => ({ row: full.get(x.id)!, date: new Date(at - i * 1000) })).filter((x) => x.row);
  });

  const feed = new Feed({
    id: siteUrl(`/feed/${slug}`),
    link: siteUrl("/"),
    title: `精选晨报 · ${topic.name}${lang === "zh" ? "（中文）" : "（原文）"}`,
    description: `每日精选 ${topic.name} 主题的 X（原 Twitter）推文`,
    language: lang === "zh" ? "zh-CN" : undefined,
    copyright: "内容版权归原作者所有",
    updated: items[0]?.date ?? now,
    feedLinks: { rss: siteUrl(`/feed/${slug}`) },
  });

  const urls = items.map(({ row: r }) => primaryArticle(r.raw)?.link.expandedUrl).filter((u): u is string => Boolean(u));
  const digests = urls.length
    ? new Map((await d.select().from(linkDigests).where(inArray(linkDigests.url, [...new Set(urls)]))).map((r) => [r.url, r.data]))
    : new Map();
  const viewOpts = { lang, timezone: cfg.digest.timezone, videoMode: cfg.digest.video_mode, maxThreadParts: cfg.digest.thread.max_parts, now };
  for (const { row: r, date } of items) {
    const p = primaryArticle(r.raw);
    const card = toCardView({ id: r.id, topicId: topic.id, kind: r.kind, raw: r.raw, ai: r.ai, article: p ? digests.get(p.link.expandedUrl) : undefined }, viewOpts);
    feed.addItem({
      id: card.url,
      link: card.url,
      title: itemTitle(card),
      content: cardHtml(card),
      date,
      author: [{ name: `${card.author.name} (@${card.author.handle})`, link: `https://x.com/${card.author.handle}` }],
    });
  }

  return new Response(feed.rss2(), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" },
  });
}
