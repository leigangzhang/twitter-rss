import { type Link, type Media, type QuotedTweet, RawTweet } from "@xrss/core";

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

function authorOf(tweet: Obj) {
  const u: Obj = tweet.core?.user_results?.result ?? {};
  const handle: string | undefined = u.core?.screen_name ?? u.legacy?.screen_name;
  const name: string | undefined = u.core?.name ?? u.legacy?.name;
  const avatar: string | undefined = u.avatar?.image_url ?? u.legacy?.profile_image_url_https;
  return {
    handle: handle ?? "",
    name: name ?? handle ?? "",
    avatarUrl: avatar?.replace("_normal.", "_bigger."),
  };
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

/** 正文：长推文取 note_tweet 全文；去掉开头的 @回复对象、结尾的媒体链接和引用链接，t.co 换成真实地址 */
function textOf(tweet: Obj, legacy: Obj): string {
  const note: string | undefined = tweet.note_tweet?.note_tweet_results?.result?.text;
  let text: string;
  if (note) {
    text = note;
  } else {
    const chars = Array.from(String(legacy.full_text ?? ""));
    const [start, end] = Array.isArray(legacy.display_text_range) ? legacy.display_text_range : [0, chars.length];
    text = chars.slice(start, end).join("");
  }
  const mediaUrls: string[] = (legacy.extended_entities?.media ?? legacy.entities?.media ?? []).map((m: Obj) => m.url);
  const quotedUrl: string | undefined = legacy.quoted_status_permalink?.url;
  for (const u of [...mediaUrls, quotedUrl]) if (u) text = text.split(u).join("");
  for (const u of legacy.entities?.urls ?? []) if (u.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  return decodeEntities(text).trim();
}

function linksOf(tweet: Obj, legacy: Obj): Link[] {
  const quotedExpanded: string | undefined = legacy.quoted_status_permalink?.expanded;
  const card = cardOf(tweet);
  return (legacy.entities?.urls ?? [])
    .filter((u: Obj) => u.expanded_url && u.expanded_url !== quotedExpanded)
    .map((u: Obj) => {
      let domain: string | undefined;
      try {
        domain = new URL(u.expanded_url).hostname.replace(/^www\./, "");
      } catch {
        domain = undefined;
      }
      const matchesCard = card.cardUrl === u.url;
      return {
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
    text: textOf(q, q.legacy),
    createdAt: q.legacy.created_at ? new Date(q.legacy.created_at).toISOString() : undefined,
    media: mediaOf(q.legacy),
  };
}

function toRaw(tweet: Obj) {
  const legacy: Obj = tweet.legacy;
  const author = authorOf(tweet);
  const id: string = tweet.rest_id ?? legacy.id_str;
  const isRepost = Boolean(legacy.retweeted_status_result) || String(legacy.full_text ?? "").startsWith("RT @");
  const replyTo: string | undefined = legacy.in_reply_to_screen_name;
  const views = Number(tweet.views?.count);
  return {
    id,
    url: `https://x.com/${author.handle}/status/${id}`,
    author,
    createdAt: new Date(legacy.created_at).toISOString(),
    text: textOf(tweet, legacy),
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
      byId.set(raw.id, raw);
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
