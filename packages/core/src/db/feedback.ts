import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AiResult } from "../types.ts";
import type { Db } from "./index.ts";
import { feedback, subscribers, tweets } from "./schema.ts";

/**
 * 管理员在后台预览里给每条推文的赞 / 踩（可选原因和说明），用来改进评审规则。
 * 邮件里不放反馈链接；表里 source = reader 的行是早先邮件反馈留下的（现在不再产生）。
 */

export type Vote = "up" | "down";
export const FEEDBACK_REASONS = ["topic", "author", "shallow", "ad", "duplicate", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export const REASON_LABELS: Record<FeedbackReason, string> = {
  topic: "话题不感兴趣",
  author: "不喜欢这个作者",
  shallow: "内容太浅",
  ad: "像广告或推广",
  duplicate: "重复",
  other: "其他",
};

/** 补充说明的长度上限 */
export const NOTE_MAX = 500;

export interface AdminFeedback {
  tweetId: string;
  issueDate: string;
  /** null：取消（再点一次同一个） */
  vote: Vote | null;
  /** 只有 👎 有原因和说明；不传表示保持不变，null 表示清除 */
  reason?: FeedbackReason | null;
  note?: string | null;
}

/**
 * 后台预览里的赞 / 踩：每条推文只留管理员的一条。点赞 / 踩时立即记录，之后可以再补原因和说明；
 * 换成另一个评价时清掉原来的原因和说明。不经过邮件链接，调用方负责确认是管理员。
 */
export async function setAdminFeedback(db: Db, input: AdminFeedback, now = new Date()): Promise<void> {
  const own = and(eq(feedback.tweetId, input.tweetId), eq(feedback.source, "admin"));
  if (!input.vote) {
    await db.delete(feedback).where(own);
    return;
  }
  const down = input.vote === "down";
  const note = input.note === undefined ? undefined : input.note?.trim().slice(0, NOTE_MAX) || null;
  const [existing] = await db.select({ id: feedback.id, vote: feedback.vote }).from(feedback).where(own);
  if (existing) {
    const changed = existing.vote !== input.vote;
    const reason = !down ? null : input.reason !== undefined ? input.reason : changed ? null : undefined;
    const keepNote = !down ? null : note !== undefined ? note : changed ? null : undefined;
    await db
      .update(feedback)
      .set({ vote: input.vote, issueDate: input.issueDate, updatedAt: now, ...(reason !== undefined && { reason }), ...(keepNote !== undefined && { note: keepNote }) })
      .where(eq(feedback.id, existing.id));
    return;
  }
  await db.insert(feedback).values({
    tweetId: input.tweetId,
    issueDate: input.issueDate,
    vote: input.vote,
    reason: down ? (input.reason ?? null) : null,
    note: down ? (note ?? null) : null,
    source: "admin",
    createdAt: now,
    updatedAt: now,
  });
}

export interface AdminVote {
  vote: Vote;
  reason: FeedbackReason | null;
  note: string | null;
}

/** 这些推文上管理员已经给过的评价（重新打开预览时显示） */
export async function adminVotes(db: Db, tweetIds: string[]): Promise<Record<string, AdminVote>> {
  if (tweetIds.length === 0) return {};
  const rows = await db
    .select({ tweetId: feedback.tweetId, vote: feedback.vote, reason: feedback.reason, note: feedback.note })
    .from(feedback)
    .where(and(eq(feedback.source, "admin"), inArray(feedback.tweetId, tweetIds)));
  return Object.fromEntries(rows.map(({ tweetId, ...v }) => [tweetId, v]));
}

/** 每一期后台给过的赞 / 踩数（期数 → 计数） */
export async function adminFeedbackCounts(db: Db): Promise<Map<string, { up: number; down: number }>> {
  const rows = await db.select({ date: feedback.issueDate, vote: feedback.vote }).from(feedback).where(eq(feedback.source, "admin"));
  const out = new Map<string, { up: number; down: number }>();
  for (const r of rows) {
    const c = out.get(r.date) ?? { up: 0, down: 0 };
    c[r.vote]++;
    out.set(r.date, c);
  }
  return out;
}

/** 后台给每个账号的赞 / 踩数（小写账号 → 计数），账号管理页用 */
export async function feedbackByHandle(db: Db): Promise<Map<string, { up: number; down: number }>> {
  const rows = await db
    .select({ handle: tweets.handle, vote: feedback.vote })
    .from(feedback)
    .innerJoin(tweets, eq(tweets.id, feedback.tweetId))
    .where(eq(feedback.source, "admin"));
  const out = new Map<string, { up: number; down: number }>();
  for (const r of rows) {
    const key = r.handle.toLowerCase();
    const c = out.get(key) ?? { up: 0, down: 0 };
    c[r.vote]++;
    out.set(key, c);
  }
  return out;
}

export interface FeedbackInfo {
  id: number;
  issueDate: string;
  vote: Vote;
  reason: FeedbackReason | null;
  note: string | null;
  source: "reader" | "admin";
  tweetId: string;
  handle: string | null;
  topicId: string | null;
  /** 当时的 AI 评审结果（类别、分数、理由），用来对照改评审规则 */
  ai: AiResult | null;
  text: string;
  email: string | null;
  updatedAt: Date;
}

/** 反馈（新的在前），供管理页和命令行使用；from / to 按期数（YYYY-MM-DD）筛选，含两端 */
export async function listFeedback(db: Db, opts: { limit?: number; vote?: Vote; from?: string; to?: string } = {}): Promise<FeedbackInfo[]> {
  const rows = await db
    .select({ f: feedback, handle: tweets.handle, topicId: tweets.topicId, ai: tweets.ai, raw: tweets.raw, email: subscribers.email })
    .from(feedback)
    .leftJoin(tweets, eq(tweets.id, feedback.tweetId))
    .leftJoin(subscribers, eq(subscribers.id, feedback.subscriberId))
    .where(
      and(
        opts.vote ? eq(feedback.vote, opts.vote) : undefined,
        opts.from ? gte(feedback.issueDate, opts.from) : undefined,
        opts.to ? lte(feedback.issueDate, opts.to) : undefined,
      ),
    )
    .orderBy(desc(feedback.updatedAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ f, handle, topicId, ai, raw, email }) => ({
    id: f.id,
    issueDate: f.issueDate,
    vote: f.vote,
    reason: f.reason,
    note: f.note,
    source: f.source,
    tweetId: f.tweetId,
    handle,
    topicId,
    ai: ai ?? null,
    text: raw?.text ?? "",
    email,
    updatedAt: f.updatedAt,
  }));
}
