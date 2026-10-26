import { type Link, type Media, type QuotedTweet, RawTweet, TRUNCATION_THRESHOLD, xWeightedLength } from "@xrss/core";

/**
 * 把 X 网页时间线的内部接口响应（UserOriginalsTimeline、UserTweets、UserTweetsAndReplies、TweetDetail 等 GraphQL 返回的 JSON）
 * 转成 RawTweet。
 *
 * 适用场景：Browser Skill 能拿到页面的网络响应时，优先用这份数据，比解析页面元素稳定，
 * 而且自带长推文全文、媒体、引用推文和链接卡片。
 *
 * 注意：这是 X 未公开的内部格式，字段会变。这里按已知结构尽量宽松地解析，
 * 拿到真实响应后应补一个测试样本（test/fixtures）再调整。
 */

// 内部格式没有类型定义，统一按松散对象处理
type Obj = Record<string, any>;

export interface ParseResult {
  tweets: RawTweet[];
  /** 结构不符、被丢弃的推文及原因 */
  skipped: Array<{ id?: string; reason: string }>;
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function unwrap(result: unknown): Obj | null {
  if (!isObj(result)) return null;
  if (result.__typename === "TweetWithVisibilityResults") return isObj(result.tweet) ? result.tweet : null;
  if (result.__typename === "TweetTombstone" || result.__typename === "TweetUnavailable") return null;
  return isObj(result.legacy) ? result : null;
}

/** X 头像统一取 73px 的 _bigger 尺寸：订阅页和邮件里够清晰，体积小 */
export function smallAvatar(url: string | undefined): string | undefined {
  return url?.replace(/_(normal|mini|200x200|400x400)\.(jpe?g|png|webp)$/i, "_bigger.$2");
}

function authorOf(tweet: Obj) {
  const u: Obj = tweet.core?.user_results?.result ?? {};
  const handle: string | undefined = u.core?.screen_name ?? u.legacy?.screen_name;
  const name: string | undefined = u.core?.name ?? u.legacy?.name;
  const avatar: string | undefined = u.avatar?.image_url ?? u.legacy?.profile_image_url_https;
  return {
    handle: handle ?? "",
    name: name ?? handle ?? "",
    avatarUrl: smallAvatar(avatar),
  };
}

/**
 * 在任意 GraphQL 响应里找这个账号的资料（显示名、头像）。
 * 时间线、详情页、UserByScreenName 里的用户对象都算，所以前一天没发推也能拿到头像。
 */
export function findProfile(responses: unknown[], handle: string): { name?: string; avatarUrl?: string } | undefined {
  const want = handle.toLowerCase();
  let found: { name?: string; avatarUrl?: string } | undefined;
  const visit = (node: unknown, depth: number): void => {
    if (found?.avatarUrl || depth > 40 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Obj;
    const screen: unknown = o.core?.screen_name ?? o.legacy?.screen_name;
    if (typeof screen === "string" && screen.toLowerCase() === want) {
      const avatar: string | undefined = o.avatar?.image_url ?? o.legacy?.profile_image_url_https;
      const name: string | undefined = o.core?.name ?? o.legacy?.name;
      if (avatar || name) found = { name: name ?? found?.name, avatarUrl: smallAvatar(avatar) ?? found?.avatarUrl };
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  for (const r of responses) visit(r, 0);
  return found;
}

/**
 * 账号资料响应（UserByScreenName）说明账号不存在或被冻结时返回原因，正常时返回 undefined。
 * 不存在的账号返回 {"data":{}} 或 data.user 为空；被冻结等返回 __typename 为 UserUnavailable 的结果。
 */
export function profileUnavailable(response: unknown): string | undefined {
  if (!isObj(response) || !isObj(response.data)) return undefined;
  const user = response.data.user;
  const result = isObj(user) ? user.result : undefined;
  if (isObj(result) && result.__typename === "UserUnavailable") {
    return `账号不可用${typeof result.reason === "string" ? `（${result.reason}）` : ""}`;
  }
  if (user === undefined || user === null || (isObj(user) && Object.keys(user).length === 0)) return "账号不存在";
  return undefined;
}

function mediaOf(legacy: Obj): Media[] {
  const list: Obj[] = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  return list.map((m) => ({
    type: m.type === "animated_gif" ? "gif" : m.type === "video" ? "video" : "photo",
    url: m.media_url_https,
    width: m.original_info?.width || undefined,
    height: m.original_info?.height || undefined,
    durationSec: m.video_info?.duration_millis ? m.video_info.duration_millis / 1000 : undefined,
    altText: m.ext_alt_text || undefined,
  }));
}

function cardOf(tweet: Obj): { cardUrl?: string; title?: string; description?: string; domain?: string; imageUrl?: string } {
  const legacy = tweet.card?.legacy;
  if (!legacy) return {};
  const values = new Map<string, Obj>((legacy.binding_values ?? []).map((b: Obj) => [b.key, b.value]));
  const str = (k: string): string | undefined => values.get(k)?.string_value;
  const img = (k: string): string | undefined => values.get(k)?.image_value?.url;
  return {
    cardUrl: str("card_url") ?? legacy.url,
    title: str("title"),
    description: str("description"),
    domain: str("domain") ?? str("vanity_url"),
    imageUrl: img("thumbnail_image_original") ?? img("summary_photo_image_original") ?? img("photo_image_full_size_original"),
  };
}

const X_ARTICLE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//;

/**
 * 正文：长推文取 note_tweet 全文；去掉开头的 @回复对象、结尾的媒体链接、引用链接和 X 长文链接，t.co 换成真实地址。
 * 时间线接口（如 UserOriginalsTimeline）不带 note_tweet，长推文只给前 280 字符左右，
 * 这时按 X 的加权字数判断是否可能被截断。
 */
function textOf(tweet: Obj, legacy: Obj): { text: string; truncated: boolean } {
  const note: string | undefined = tweet.note_tweet?.note_tweet_results?.result?.text;
  let text: string;
  let truncated = false;
  if (note) {
    text = note;
  } else {
    const chars = Array.from(String(legacy.full_text ?? ""));
    const [start, end] = Array.isArray(legacy.display_text_range) ? legacy.display_text_range : [0, chars.length];
    text = chars.slice(start, end).join("");
    truncated = xWeightedLength(decodeEntities(text)) >= TRUNCATION_THRESHOLD;
  }
  const mediaUrls: string[] = (legacy.extended_entities?.media ?? legacy.entities?.media ?? []).map((m: Obj) => m.url);
  const quotedUrl: string | undefined = legacy.quoted_status_permalink?.url;
  for (const u of [...mediaUrls, quotedUrl]) if (u) text = text.split(u).join("");
  for (const u of legacy.entities?.urls ?? []) {
    if (!u.url || !u.expanded_url) continue;
    // X 长文会以卡片形式展示，正文里不再重复它的链接
    text = text.split(u.url).join(X_ARTICLE.test(u.expanded_url) ? "" : u.expanded_url);
  }
  // 正文最后的外部链接会以文章卡片展示，不在正文里重复（正文中间的链接保留）
  let body = decodeEntities(text).trim();
  for (const u of legacy.entities?.urls ?? []) {
    if (u.expanded_url && body.endsWith(u.expanded_url)) body = body.slice(0, -u.expanded_url.length).trim();
  }
  return { text: body, truncated };
}

/** TweetDetail 中 X 长文的标题、摘要和封面（时间线接口通常没有） */
function articleOf(tweet: Obj): { title?: string; description?: string; imageUrl?: string } {
  const a: Obj | undefined = tweet.article?.article_results?.result;
  if (!a) return {};
  return {
    title: a.title || undefined,
    description: a.preview_text || undefined,
    imageUrl: a.cover_media?.media_info?.original_img_url || undefined,
  };
}

function linksOf(tweet: Obj, legacy: Obj): Link[] {
  const quotedExpanded: string | undefined = legacy.quoted_status_permalink?.expanded;
  const card = cardOf(tweet);
  const article = articleOf(tweet);
  return (legacy.entities?.urls ?? [])
    .filter((u: Obj) => u.expanded_url && u.expanded_url !== quotedExpanded)
    .map((u: Obj) => {
      let domain: string | undefined;
      try {
        domain = new URL(u.expanded_url).hostname.replace(/^www\./, "");
      } catch {
        domain = undefined;
      }
      if (X_ARTICLE.test(u.expanded_url)) {
        return { kind: "x_article" as const, url: u.url, expandedUrl: u.expanded_url, domain: "x.com", ...article };
      }
      const matchesCard = card.cardUrl === u.url;
      return {
        kind: "web" as const,
        url: u.url,
        expandedUrl: u.expanded_url,
        domain: (matchesCard && card.domain) || domain,
        title: matchesCard ? card.title : undefined,
        description: matchesCard ? card.description : undefined,
        imageUrl: matchesCard ? card.imageUrl : undefined,
      };
    });
}

function quotedOf(tweet: Obj): QuotedTweet | undefined {
  const q = unwrap(tweet.quoted_status_result?.result);
  if (!q) return undefined;
  const author = authorOf(q);
  const id: string = q.rest_id ?? q.legacy.id_str;
  return {
    id,
    url: `https://x.com/${author.handle}/status/${id}`,
    author: { ...author, handle: author.handle.toLowerCase() },
    text: textOf(q, q.legacy).text,
    createdAt: q.legacy.created_at ? new Date(q.legacy.created_at).toISOString() : undefined,
    media: mediaOf(q.legacy),
    links: linksOf(q, q.legacy),
  };
}

function toRaw(tweet: Obj) {
  const legacy: Obj = tweet.legacy;
  const author = authorOf(tweet);
  const id: string = tweet.rest_id ?? legacy.id_str;
  const isRepost = Boolean(legacy.retweeted_status_result) || String(legacy.full_text ?? "").startsWith("RT @");
  const replyTo: string | undefined = legacy.in_reply_to_screen_name;
  const views = Number(tweet.views?.count);
  const body = textOf(tweet, legacy);
  return {
    id,
    url: `https://x.com/${author.handle}/status/${id}`,
    author,
    createdAt: new Date(legacy.created_at).toISOString(),
    text: body.text,
    textTruncated: body.truncated,
    lang: legacy.lang,
    isReply: Boolean(legacy.in_reply_to_status_id_str) && replyTo?.toLowerCase() !== author.handle.toLowerCase(),
    isRepost,
    conversationId: legacy.conversation_id_str,
    inReplyToId: legacy.in_reply_to_status_id_str as string | undefined,
    metrics: {
      likes: legacy.favorite_count ?? 0,
      reposts: legacy.retweet_count ?? 0,
      replies: legacy.reply_count ?? 0,
      quotes: legacy.quote_count ?? 0,
      bookmarks: legacy.bookmark_count,
      views: Number.isFinite(views) ? views : undefined,
    },
    media: mediaOf(legacy),
    links: linksOf(tweet, legacy),
    quoted: quotedOf(tweet),
    thread: [] as RawTweet["thread"],
  };
}

type Parsed = ReturnType<typeof toRaw>;

/**
 * 同一条推文出现在多个响应里（时间线 + 详情页）时合并：
 * 正文取未截断、更长的版本；链接卡片和 X 长文信息取有标题的版本；互动数取较大值（较新）。
 */
function mergeVersions(a: Parsed, b: Parsed): Parsed {
  const better = a.textTruncated !== b.textTruncated ? (a.textTruncated ? b : a) : b.text.length > a.text.length ? b : a;
  const other = better === a ? b : a;
  const max = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.max(x, y));
  // 一方缺失的字段（如语言、头像）用另一方补上
  const filled = { ...better } as Record<string, unknown>;
  for (const [k, v] of Object.entries(other)) if (filled[k] === undefined) filled[k] = v;
  return {
    ...(filled as Parsed),
    author: { ...other.author, ...better.author, avatarUrl: better.author.avatarUrl ?? other.author.avatarUrl },
    textTruncated: a.textTruncated && b.textTruncated,
    links: better.links.map((l) => {
      if (l.title) return l;
      const rich = other.links.find((o) => o.expandedUrl === l.expandedUrl && o.title);
      return rich ? { ...l, ...rich, url: l.url } : l;
    }),
    media: better.media.length >= other.media.length ? better.media : other.media,
    quoted: better.quoted ?? other.quoted,
    metrics: {
      likes: Math.max(a.metrics.likes, b.metrics.likes),
      reposts: Math.max(a.metrics.reposts, b.metrics.reposts),
      replies: Math.max(a.metrics.replies, b.metrics.replies),
      quotes: Math.max(a.metrics.quotes, b.metrics.quotes),
      bookmarks: max(a.metrics.bookmarks, b.metrics.bookmarks),
      views: max(a.metrics.views, b.metrics.views),
    },
  };
}

/** 需要打开详情页补抓的推文：长推文被截断、X 长文缺标题 */
export interface DetailTarget {
  id: string;
  url: string;
  reason: "truncated" | "x_article";
}

export function detailTargets(tweets: RawTweet[]): DetailTarget[] {
  const out: DetailTarget[] = [];
  for (const t of tweets) {
    if (t.isRepost || t.isReply) continue;
    if (t.textTruncated) out.push({ id: t.id, url: t.url, reason: "truncated" });
    else if (t.links.some((l) => l.kind === "x_article" && !l.title)) out.push({ id: t.id, url: t.url, reason: "x_article" });
  }
  return out;
}

/** 在任意嵌套的响应里找出所有 tweet_results，跳过广告 */
function collect(node: unknown, out: Obj[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!isObj(node)) return;
  if (node.promotedMetadata) return;
  if (isObj(node.tweet_results)) {
    const t = unwrap(node.tweet_results.result);
    if (t) out.push(t);
    return;
  }
  for (const v of Object.values(node)) collect(v, out);
}

/**
 * @param responses 一个或多个 GraphQL 响应 JSON
 * @param handle    只保留这个账号发的推文（个人主页里可能混有别人的推文）
 */
export function parseXGraphQL(responses: unknown[], handle?: string): ParseResult {
  const found: Obj[] = [];
  for (const r of responses) collect(r, found);

  const byId = new Map<string, ReturnType<typeof toRaw>>();
  const skipped: ParseResult["skipped"] = [];
  for (const t of found) {
    try {
      const raw = toRaw(t);
      if (handle && raw.author.handle.toLowerCase() !== handle.toLowerCase()) continue;
      const prev = byId.get(raw.id);
      byId.set(raw.id, prev ? mergeVersions(prev, raw) : raw);
    } catch (e) {
      skipped.push({ id: t.rest_id, reason: (e as Error).message });
    }
  }

  // 作者回复自己 = Thread 的后续部分，合并进 Thread 开头那条
  const roots = [...byId.values()];
  const merged = new Set<string>();
  for (const t of roots) {
    if (!t.inReplyToId || t.isReply || !t.conversationId || t.conversationId === t.id) continue;
    const root = byId.get(t.conversationId);
    if (!root) continue;
    root.thread.push({ id: t.id, text: t.text, media: t.media });
    merged.add(t.id);
  }

  const tweets: RawTweet[] = [];
  for (const t of byId.values()) {
    if (merged.has(t.id)) continue;
    t.thread.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const { inReplyToId: _drop, ...rest } = t;
    const parsed = RawTweet.safeParse(rest);
    if (parsed.success) tweets.push(parsed.data);
    else skipped.push({ id: t.id, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  tweets.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
  return { tweets, skipped };
}
