import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./index.ts";
import { feedback, subscribers, tweets } from "./schema.ts";

/**
 * 邮件里每条推文下的 👍 / 👎 反馈链接：打开 <网站>/f?... 是确认页，点"确认"才记录（邮箱的安全扫描会预先打开链接）。
 * - 单独发送：带订阅者 token（s），和管理订阅链接一样能确定是谁，同一人对同一条重复反馈会覆盖；
 * - 合并发送：不知道是谁，带 FEEDBACK_SECRET 算出的签名（g）防止伪造；没设置 FEEDBACK_SECRET 时合并邮件不放反馈链接。
 */

export type Vote = "up" | "down";
export const FEEDBACK_REASONS = ["topic", "author", "shallow", "ad", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export const REASON_LABELS: Record<FeedbackReason, string> = {
  topic: "话题不感兴趣",
  author: "不喜欢这个作者",
  shallow: "内容太浅",
  ad: "像广告",
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
    await db.insert(feedback).values({ ...input, reason, createdAt: now, updatedAt: now });
    return;
  }
  await db
    .insert(feedback)
    .values({ ...input, reason, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [feedback.tweetId, feedback.subscriberId],
      set: { vote: input.vote, reason, issueDate: input.issueDate, updatedAt: now },
    });
}

export interface FeedbackInfo {
  id: number;
  issueDate: string;
  vote: Vote;
  reason: FeedbackReason | null;
  tweetId: string;
  handle: string | null;
  text: string;
  email: string | null;
  updatedAt: Date;
}

/** 最近的反馈（新的在前），供管理页和命令行使用 */
export async function listFeedback(db: Db, opts: { limit?: number; vote?: Vote } = {}): Promise<FeedbackInfo[]> {
  const rows = await db
    .select({ f: feedback, handle: tweets.handle, raw: tweets.raw, email: subscribers.email })
    .from(feedback)
    .leftJoin(tweets, eq(tweets.id, feedback.tweetId))
    .leftJoin(subscribers, eq(subscribers.id, feedback.subscriberId))
    .where(opts.vote ? eq(feedback.vote, opts.vote) : undefined)
    .orderBy(desc(feedback.updatedAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ f, handle, raw, email }) => ({
    id: f.id,
    issueDate: f.issueDate,
    vote: f.vote,
    reason: f.reason,
    tweetId: f.tweetId,
    handle,
    text: raw?.text ?? "",
    email,
    updatedAt: f.updatedAt,
  }));
}
