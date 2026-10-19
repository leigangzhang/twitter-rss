import { sql } from "drizzle-orm";
import { customType, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { type AiResult, type Lang, type LinkDigest, type MediaKind, RawTweet } from "../types.ts";

/**
 * 推文原始数据（JSON）。读出时按当前的 RawTweet 补齐默认值：
 * 旧版本存进去的数据可能缺少后来新增的字段（例如引用推文的 links），不补齐会让展示代码出错。
 */
const rawTweetJson = customType<{ data: RawTweet; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => {
    const json = JSON.parse(value);
    const parsed = RawTweet.safeParse(json);
    return parsed.success ? parsed.data : json;
  },
});

const now = sql`(unixepoch() * 1000)`;

/** 被跟踪的账号；哪个账号属于哪个主题以 config/topics.yaml 为准 */
export const accounts = sqliteTable("accounts", {
  handle: text("handle").primaryKey(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  /** 上次采集到的最新推文 ID，采集端遇到它就停止滚动 */
  lastSeenId: text("last_seen_id"),
  lastCollectedAt: integer("last_collected_at", { mode: "timestamp_ms" }),
  /** 已入库内容覆盖到的时间点：下次采集从这里补收（轮转到的账号不会丢内容） */
  coveredUntil: integer("covered_until", { mode: "timestamp_ms" }),
  /** 时间线上看到的最新一条推文的发布时间，用来判断账号是否还活跃 */
  lastTweetAt: integer("last_tweet_at", { mode: "timestamp_ms" }),
  lastStatus: text("last_status"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const tweets = sqliteTable(
  "tweets",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    kind: text("kind").$type<MediaKind>().notNull(),
    raw: rawTweetJson("raw").notNull(),
    engagement: real("engagement").notNull(),
    /**
     * new：已入库；filtered：规则排除；scored：通过 AI 精选，可进入邮件；
     * rejected：AI 初审或编辑终审剔除（原因见 filterReason）；failed：AI 处理失败
     */
    status: text("status").$type<"new" | "filtered" | "scored" | "rejected" | "failed">().notNull().default("new"),
    filterReason: text("filter_reason"),
    ruleScore: real("rule_score"),
    ai: text("ai", { mode: "json" }).$type<AiResult>(),
    topicId: text("topic_id"),
    finalScore: real("final_score"),
    collectedAt: integer("collected_at", { mode: "timestamp_ms" }).notNull().default(now),
    /** 首次入库的运行日期（YYYY-MM-DD）：同一天入库的推文一起评审和发送，包括补收的前几天内容 */
    batchDate: text("batch_date"),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("tweets_handle_created").on(t.handle, t.createdAt),
    index("tweets_topic_score").on(t.topicId, t.finalScore),
    index("tweets_status").on(t.status),
    index("tweets_batch").on(t.batchDate),
  ],
);

export const subscribers = sqliteTable("subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  lang: text("lang").$type<Lang>().notNull().default("zh"),
  topics: text("topics", { mode: "json" }).$type<string[]>().notNull(),
  /** pending：待确认；active：正常；unsubscribed：已退订 */
  status: text("status").$type<"pending" | "active" | "unsubscribed">().notNull().default("pending"),
  /** 用于确认、管理偏好、退订链接 */
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

/** 发送记录，同一订阅者同一天只发一封 */
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriberId: integer("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    digestDate: text("digest_date").notNull(),
    tweetIds: text("tweet_ids", { mode: "json" }).$type<string[]>().notNull(),
    messageId: text("message_id"),
    status: text("status").$type<"sent" | "failed">().notNull(),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("deliveries_sub_date").on(t.subscriberId, t.digestDate)],
);

/**
 * 每一次发送尝试的流水（定时发送、补发、重新发送、重试），只增不改，用于推送历史。
 * deliveries 只保留每人每期的最终结果。
 */
export const deliveryAttempts = sqliteTable(
  "delivery_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriberId: integer("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    digestDate: text("digest_date").notNull(),
    /** scheduled：每日定时；missing：补发给当期没收到的；resend：手动重新发送；retry：重试失败的 */
    kind: text("kind").$type<"scheduled" | "missing" | "resend" | "retry">().notNull(),
    /** 合并发送（密送）时同一封邮件的收件人数，单独发送为 1 */
    recipients: integer("recipients").notNull().default(1),
    tweetIds: text("tweet_ids", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status").$type<"sent" | "failed">().notNull(),
    messageId: text("message_id"),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("delivery_attempts_date").on(t.digestDate)],
);

/** 外部文章的抓取结果和 AI 摘要，按链接缓存 */
export const linkDigests = sqliteTable("link_digests", {
  url: text("url").primaryKey(),
  data: text("data", { mode: "json" }).$type<LinkDigest>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export type TweetRow = typeof tweets.$inferSelect;
export type SubscriberRow = typeof subscribers.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryAttemptRow = typeof deliveryAttempts.$inferSelect;
