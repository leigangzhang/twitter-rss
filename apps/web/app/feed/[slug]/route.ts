import { type ArticleView, type CardView, type Lang, effectiveTopicId, primaryArticle, qualityOf, resolveTopicId, toCardView } from "@xrss/core";
import { linkDigests, tweets } from "@xrss/core/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { Feed } from "feed";
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
  const images = c.images.map((img) => `<p><img src="${esc(img.url)}" alt="${esc(img.alt ?? "")}"></p>`).join("");
  const note = c.mediaNote ? `<blockquote><strong>${c.video ? "视频说明" : "图片说明"}（AI 生成）：</strong>${esc(c.mediaNote)}</blockquote>` : "";
  const quoted = c.quoted
    ? `<blockquote><strong>${esc(c.quoted.name)}</strong> <a href="${esc(c.quoted.url)}">@${esc(c.quoted.handle)}</a><br>${esc(c.quoted.text)}${c.quoted.article ? articleHtml(c.quoted.article) : ""}</blockquote>`
    : "";
  const linkTitle = c.link?.title ?? (c.link?.kind === "x_article" ? "在 X（原 Twitter）上阅读这篇长文" : undefined);
  const link = c.link && linkTitle ? `<p>🔗 <a href="${esc(c.link.url)}">${esc(linkTitle)}</a>${c.link.description ? `<br>${esc(c.link.description)}` : ""}</p>` : "";
  const meta = `<p><small>${c.categoryLabel ? `【${c.categoryLabel}】` : ""}@${esc(c.author.handle)}${c.translatedFrom ? ` · ${c.translatedFrom}` : ""} · ♡ ${c.likes} · ⇄ ${c.reposts} · <a href="${esc(c.url)}">${c.ctaLabel}</a></small></p>`;
  return parts + images + note + quoted + (c.article ? articleHtml(c.article) : link) + meta;
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const match = /^([a-z][a-z0-9-]*)\.(zh|orig)\.xml$/.exec(slug);
  const cfg = config();
  const topicId = match ? resolveTopicId(cfg, match[1]) : undefined;
  const topic = topicId ? cfg.topics.find((t) => t.id === topicId) : undefined;
  if (!match || !topic) return new Response("未找到这个 Feed", { status: 404 });
  // 主题合并前的旧地址：永久跳转到新主题的 Feed
  if (topic.id !== match[1]) return Response.redirect(siteUrl(`/feed/${topic.id}.${match[2]}.xml`), 301);
  const lang = match[2] as Lang;

  const rows = await (await db())
    .select()
    .from(tweets)
    .where(
      and(
        eq(tweets.status, "scored"),
        or(inArray(tweets.topicId, [topic.id, ...topic.aliases]), inArray(tweets.handle, topic.accounts)),
        gte(tweets.createdAt, new Date(Date.now() - 30 * 86_400_000)),
      ),
    )
    .orderBy(desc(tweets.createdAt))
    .limit(cfg.digest.rss.items_per_feed * 3);
  const items = rows
    .filter((r) => effectiveTopicId(cfg, r.topicId, r.handle) === topic.id && qualityOf(r.ai) >= cfg.digest.filters.min_quality)
    .slice(0, cfg.digest.rss.items_per_feed);

  const feed = new Feed({
    id: siteUrl(`/feed/${slug}`),
    link: siteUrl("/"),
    title: `精选晨报 · ${topic.name}${lang === "zh" ? "（中文）" : "（原文）"}`,
    description: `每日精选 ${topic.name} 主题的 X（原 Twitter）推文`,
    language: lang === "zh" ? "zh-CN" : undefined,
    copyright: "内容版权归原作者所有",
    updated: items[0]?.createdAt ?? new Date(),
    feedLinks: { rss: siteUrl(`/feed/${slug}`) },
  });

  const urls = items.map((r) => primaryArticle(r.raw)?.link.expandedUrl).filter((u): u is string => Boolean(u));
  const digests = urls.length
    ? new Map((await (await db()).select().from(linkDigests).where(inArray(linkDigests.url, [...new Set(urls)]))).map((r) => [r.url, r.data]))
    : new Map();
  const viewOpts = { lang, timezone: cfg.digest.timezone, videoMode: cfg.digest.video_mode, maxThreadParts: cfg.digest.thread.max_parts };
  for (const r of items) {
    const p = primaryArticle(r.raw);
    const card = toCardView({ id: r.id, topicId: topic.id, kind: r.kind, raw: r.raw, ai: r.ai, article: p ? digests.get(p.link.expandedUrl) : undefined }, viewOpts);
    const first = card.parts[0] ?? "";
    feed.addItem({
      id: card.url,
      link: card.url,
      title: `${card.author.name}：${first.length > 60 ? `${first.slice(0, 60)}…` : first}`,
      content: cardHtml(card),
      date: r.createdAt,
      author: [{ name: `${card.author.name} (@${card.author.handle})`, link: `https://x.com/${card.author.handle}` }],
    });
  }

  return new Response(feed.rss2(), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" },
  });
}
