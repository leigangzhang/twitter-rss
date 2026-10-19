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
  /** 被引用推文里的链接（含 X 卡片的标题、简介、封面） */
  links: z.array(Link).default([]),
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
  /** 账号资料：没有新推文时也记录，订阅页用来显示头像 */
  profile: z
    .object({
      name: z.string().optional(),
      avatarUrl: z.url().optional(),
    })
    .optional(),
  tweets: z.array(RawTweet).default([]),
});
export type InboxFile = z.infer<typeof InboxFile>;

export type MediaKind = "text" | "image" | "video";

export type Lang = "zh" | "orig";

/** 读者想看的四类高价值内容；other 表示不属于这四类 */
export const ContentCategory = z.enum(["best_practice", "real_problem", "new_release", "showcase", "industry_trend", "expert_insight", "other"]);
export type ContentCategory = z.infer<typeof ContentCategory>;

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  best_practice: "最佳实践",
  real_problem: "真实问题",
  new_release: "新发布",
  showcase: "应用案例",
  industry_trend: "趋势解读",
  expert_insight: "专家观点",
  other: "其他",
};

/** 剔除原因 */
export const DropReason = z.enum(["preachy", "obvious", "shallow", "repost", "duplicate", "promo", "chitchat", "other"]);
export type DropReason = z.infer<typeof DropReason>;

export const DROP_REASON_LABELS: Record<DropReason, string> = {
  preachy: "说教",
  obvious: "显而易见",
  shallow: "没有思考",
  repost: "纯搬运",
  duplicate: "重复",
  promo: "推广",
  chitchat: "闲聊",
  other: "其他",
};

/** 统一换算成 5 分制（旧数据是 10 分制），保留一位小数 */
export function qualityOf(ai: { quality: number; scale?: number } | null | undefined): number {
  if (!ai) return 0;
  return ai.scale === 5 ? ai.quality : Math.round((ai.quality / 2) * 10) / 10;
}

/** AI 评审结果：价值判断 + 中文版内容 + 说明 */
export const AiResult = z.object({
  /** keep：值得推荐；drop：剔除 */
  verdict: z.enum(["keep", "drop"]),
  /** 内容类型 */
  category: ContentCategory,
  /** verdict 为 drop 时的主要原因，keep 时为 null */
  dropReason: DropReason.nullable(),
  /**
   * 质量分。现在是 5 分制（scale 为 5）：5 必读，4 值得读，3 有收获，2 价值低，1 不推荐；保留的至少 3 分。
   * 旧数据没有 scale，是 0–10 分制。读取时一律用 qualityOf() 换算成 5 分制。
   */
  quality: z.number().min(0).max(10),
  /** 5：5 分制；缺省：旧的 10 分制 */
  scale: z.literal(5).optional(),
  /** 从该账号所属主题中选一个最贴近的 */
  topicId: z.string(),
  /** 一句话中文摘要（30–60 字），说清这条讲了什么，用于终审去重 */
  summary: z.string(),
  /** 一句话说明判断理由，便于调整精选标准 */
  reason: z.string(),
  /** 原文已是中文时为 null */
  zh: z
    .object({
      text: z.string(),
      thread: z.array(z.string()).default([]),
      // 模型会把“没有翻译”显式返回成 null，而不仅是省略字段
      quotedText: z.string().nullish(),
      linkTitle: z.string().nullish(),
      linkDescription: z.string().nullish(),
    })
    .nullable(),
  /**
   * 引用推文较长或被截断时的中文摘要和要点（短引用为 null，直接显示原文 / 译文）。
   * 被截断时只概括能看到的部分。
   */
  quotedDigest: z
    .object({
      summary: z.string(),
      points: z.array(z.string()).max(4).default([]),
    })
    .nullish(),
  /** 视频或含文字图片的中文说明，没有则为 null */
  mediaNote: z.string().nullable(),
});
export type AiResult = z.infer<typeof AiResult>;

/**
 * 推文或引用推文中外部文章的图文摘要。按链接缓存，同一篇文章只抓取、总结一次。
 * 抓取在评审前完成（供初审判断价值），中文摘要在通过精选后生成。
 */
export const LinkDigest = z.object({
  url: z.string(),
  /** 跳转后的最终地址 */
  finalUrl: z.string().optional(),
  siteName: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  /** 正文开头的一段，用于评审和总结（不在邮件里显示） */
  excerpt: z.string().optional(),
  /** 提取到的正文字数 */
  textLength: z.number().int().nonnegative().default(0),
  /** fetched：抓取成功；failed：抓取失败（只能用 X 卡片信息）；skipped：不抓取的链接 */
  status: z.enum(["fetched", "failed", "skipped"]),
  error: z.string().optional(),
  fetchedAt: z.string(),
  /** AI 生成的中文标题、概要和要点 */
  titleZh: z.string().optional(),
  summary: z.string().optional(),
  points: z.array(z.string()).default([]),
  summarizedAt: z.string().optional(),
});
export type LinkDigest = z.infer<typeof LinkDigest>;
