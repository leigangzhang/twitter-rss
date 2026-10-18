import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AiResult, Lang, LinkDigest, MediaKind, RawTweet } from "../types.ts";

const now = sql`(unixepoch() * 1000)`;

/** 被跟踪的账号；哪个账号属于哪个主题以 config/topics.yaml 为准 */
export const accounts = sqliteTable("accounts", {
  handle: text("handle").primaryKey(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  /** 上次采集到的最新推文 ID，采集端遇到它就停止滚动 */
  lastSeenId: text("last_seen_id"),
  lastCollectedAt: integer("last_collected_at", { mode: "timestamp_ms" }),
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
    raw: text("raw", { mode: "json" }).$type<RawTweet>().notNull(),
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
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("tweets_handle_created").on(t.handle, t.createdAt),
    index("tweets_topic_score").on(t.topicId, t.finalScore),
    index("tweets_status").on(t.status),
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

/** 外部文章的抓取结果和 AI 摘要，按链接缓存 */
export const linkDigests = sqliteTable("link_digests", {
  url: text("url").primaryKey(),
  data: text("data", { mode: "json" }).$type<LinkDigest>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export type TweetRow = typeof tweets.$inferSelect;
export type SubscriberRow = typeof subscribers.$inferSelect;
