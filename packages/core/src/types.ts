import { z } from "zod";

/**
 * 采集端（Browser Skill）与流水线之间的数据契约。
 * 无论采集方式怎么换，只要输出符合 InboxFile，下游都不用改。
 * 导出的 JSON Schema 见 schemas/raw-tweet.schema.json（pnpm schema 重新生成）。
 */

const TweetId = z.string().regex(/^\d+$/, "推文 ID 应为纯数字字符串");
const Handle = z
  .string()
  .regex(/^[A-Za-z0-9_]{1,15}$/, "X 账号只包含字母、数字和下划线")
  .transform((h) => h.toLowerCase());

export const Media = z.object({
  type: z.enum(["photo", "video", "gif"]),
  /** 图片地址；视频时为视频封面 */
  url: z.url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** 视频时长（秒） */
  durationSec: z.number().nonnegative().optional(),
  altText: z.string().optional(),
});
export type Media = z.infer<typeof Media>;

export const Link = z.object({
  /** web：普通网页；x_article：X 长文（x.com/i/article/…） */
  kind: z.enum(["web", "x_article"]).default("web"),
  /** 推文里的 t.co 短链 */
  url: z.string(),
  /** 还原后的真实地址 */
  expandedUrl: z.url(),
  domain: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.url().optional(),
});
export type Link = z.infer<typeof Link>;

export const Author = z.object({
  handle: Handle,
  name: z.string(),
  avatarUrl: z.url().optional(),
});
export type Author = z.infer<typeof Author>;

export const Metrics = z.object({
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  quotes: z.number().int().nonnegative().default(0),
  bookmarks: z.number().int().nonnegative().optional(),
  views: z.number().int().nonnegative().optional(),
});
export type Metrics = z.infer<typeof Metrics>;

export const QuotedTweet = z.object({
  id: TweetId,
  url: z.url(),
  author: Author,
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  media: z.array(Media).default([]),
});
export type QuotedTweet = z.infer<typeof QuotedTweet>;

export const ThreadPart = z.object({
  id: TweetId,
  text: z.string(),
  media: z.array(Media).default([]),
});
export type ThreadPart = z.infer<typeof ThreadPart>;

export const RawTweet = z.object({
  id: TweetId,
  url: z.url(),
  author: Author,
  /** ISO 8601，带时区，例如 2026-10-18T01:12:00.000Z */
  createdAt: z.iso.datetime({ offset: true }),
  /** 完整正文。长推文（note tweet）必须是全文，不能是截断版 */
  text: z.string(),
  /**
   * 正文可能被截断：时间线接口（如 UserOriginalsTimeline）不返回长推文全文，
   * 需要打开推文详情页（TweetDetail）补抓。仍为 true 时，邮件会提示"全文较长"。
   */
  textTruncated: z.boolean().default(false),
  /** X 标注的语言代码，如 en / zh / ja */
  lang: z.string().optional(),
  isReply: z.boolean().default(false),
  isRepost: z.boolean().default(false),
  conversationId: TweetId.optional(),
  metrics: Metrics,
  media: z.array(Media).default([]),
  links: z.array(Link).default([]),
  quoted: QuotedTweet.optional(),
  /** 作者本人在同一 Thread 中的后续推文，按顺序排列（不含本条） */
  thread: z.array(ThreadPart).default([]),
});
export type RawTweet = z.infer<typeof RawTweet>;

/** 采集端每个账号输出一个文件：data/inbox/<YYYY-MM-DD>/<handle>.json */
export const InboxFile = z.object({
  /** 采集方式标识，例如 "tencent-browser-skill@0.x" */
  source: z.string(),
  collectedAt: z.iso.datetime({ offset: true }),
  handle: Handle,
  /**
   * ok：正常；rate_limited：被限流；login_required：登录失效；
   * captcha：出现验证；error：其他错误。非 ok 时流水线会提醒并跳过熔断后的账号。
   */
  status: z.enum(["ok", "rate_limited", "login_required", "captcha", "error"]).default("ok"),
  error: z.string().optional(),
  tweets: z.array(RawTweet).default([]),
});
export type InboxFile = z.infer<typeof InboxFile>;

export type MediaKind = "text" | "image" | "video";

export type Lang = "zh" | "orig";

/** AI 处理结果（中文版内容 + 说明） */
export const AiResult = z.object({
  /** 0–10，信息密度、原创性、可读性综合判断 */
  quality: z.number().min(0).max(10),
  /** 从该账号所属主题中选一个最贴近的 */
  topicId: z.string(),
  /** 一句话说明打分理由，便于调参 */
  reason: z.string(),
  /** 原文已是中文时为 null */
  zh: z
    .object({
      text: z.string(),
      thread: z.array(z.string()).default([]),
      quotedText: z.string().optional(),
      linkTitle: z.string().optional(),
      linkDescription: z.string().optional(),
    })
    .nullable(),
  /** 视频或含文字图片的中文说明，没有则为 null */
  mediaNote: z.string().nullable(),
});
export type AiResult = z.infer<typeof AiResult>;
