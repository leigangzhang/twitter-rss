import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AiResult } from "../types.ts";
import type { Db } from "./index.ts";
import { feedback, subscribers, tweets } from "./schema.ts";

/**
 * 邮件里每条推文下的 👍 / 👎 反馈链接：打开 <网站>/f?... 是确认页，点"确认"才记录（邮箱的安全扫描会预先打开链接）。
 * - 单独发送：带订阅者 token（s），和管理订阅链接一样能确定是谁，同一人对同一条重复反馈会覆盖；
 * - 合并发送：不知道是谁，带 FEEDBACK_SECRET 算出的签名（g）防止伪造；没设置 FEEDBACK_SECRET 时合并邮件不放反馈链接。
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

/** 合并邮件的签名长度（base64url 字符），够防猜测，链接也不会太长 */
const SIGNATURE_CHARS = 16;
const TWEET_ID = /^\d{1,25}$/;
const ISSUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 签名只覆盖推文和期数，不含 👍/👎：确认页上可以改选另一个 */
export function feedbackSignature(secret: string, tweetId: string, issueDate: string): string {
  return createHmac("sha256", secret).update(`feedback:${tweetId}:${issueDate}`).digest("base64url").slice(0, SIGNATURE_CHARS);
}

export type FeedbackSigner = { token: string } | { secret: string };

/** 一条推文的 👍 / 👎 链接 */
export function feedbackLinks(site: string, signer: FeedbackSigner, tweetId: string, issueDate: string): { up: string; down: string } {
  const base = new URLSearchParams({ t: tweetId, d: issueDate });
  if ("token" in signer) base.set("s", signer.token);
  else base.set("g", feedbackSignature(signer.secret, tweetId, issueDate));
  const link = (v: Vote) => `${site.replace(/\/$/, "")}/f?${base.toString()}&v=${v}`;
  return { up: link("up"), down: link("down") };
}

export interface FeedbackRequest {
  tweetId: string;
  issueDate: string;
  vote: Vote;
  /** 单独发送的邮件里带的订阅者 token */
  token?: string;
  /** 合并发送的邮件里带的签名 */
  signature?: string;
}

/** 校验链接参数的格式（不查数据库、不验签），不合法时返回 null */
export function parseFeedbackParams(get: (key: string) => string | null | undefined): FeedbackRequest | null {
  const tweetId = get("t") ?? "";
  const issueDate = get("d") ?? "";
  const vote = get("v");
  const token = get("s") || undefined;
  const signature = get("g") || undefined;
  if (!TWEET_ID.test(tweetId) || !ISSUE_DATE.test(issueDate) || (vote !== "up" && vote !== "down")) return null;
  if (!token && !signature) return null;
  if (token && token.length > 100) return null;
  return { tweetId, issueDate, vote, token, signature };
}

export function parseReason(value: unknown): FeedbackReason | null {
  return typeof value === "string" && (FEEDBACK_REASONS as readonly string[]).includes(value) ? (value as FeedbackReason) : null;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * 确认链接是真的：token 要对应一位订阅者，签名要和 FEEDBACK_SECRET 算出的一致，推文要存在。
 * 通过时返回订阅者 id（合并邮件为 null）。
 */
export async function verifyFeedback(db: Db, req: FeedbackRequest, secret = process.env.FEEDBACK_SECRET): Promise<{ subscriberId: number | null } | null> {
  const [tweet] = await db.select({ id: tweets.id }).from(tweets).where(eq(tweets.id, req.tweetId));
  if (!tweet) return null;
  if (req.token) {
    const [sub] = await db.select({ id: subscribers.id }).from(subscribers).where(eq(subscribers.token, req.token));
    return sub ? { subscriberId: sub.id } : null;
  }
  if (!secret || !req.signature) return null;
  return same(req.signature, feedbackSignature(secret, req.tweetId, req.issueDate)) ? { subscriberId: null } : null;
}

/** 记录一次反馈：有订阅者时同一人同一条只留一条（覆盖），合并邮件的匿名反馈每次新增一条 */
export async function recordFeedback(
  db: Db,
  input: { tweetId: string; issueDate: string; vote: Vote; reason: FeedbackReason | null; subscriberId: number | null },
  now = new Date(),
): Promise<void> {
  const reason = input.vote === "down" ? input.reason : null;
  if (input.subscriberId === null) {
    await db.insert(feedback).values({ ...input, reason, source: "reader", createdAt: now, updatedAt: now });
    return;
  }
  await db
    .insert(feedback)
    .values({ ...input, reason, source: "reader", createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [feedback.tweetId, feedback.subscriberId],
      set: { vote: input.vote, reason, issueDate: input.issueDate, updatedAt: now },
    });
}

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
