import { accountWeight, type AiResult, type AppConfig, bodyLength, CATEGORY_LABELS, DROP_REASON_LABELS, finalScore, type LinkDigest, qualityOf, type RawTweet } from "@xrss/core";
import { type Db, tweets, type TweetRow } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import type { Reviewer } from "./ai.ts";

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

/** 初审是否通过；不通过时返回中文原因（写入 filterReason，也用于精选报告） */
export function gate(ai: AiResult, config: AppConfig, strict: boolean): string | null {
  if (!strict) return null;
  if (ai.verdict === "drop") return `初审剔除：${DROP_REASON_LABELS[ai.dropReason ?? "other"]}`;
  if (!config.digest.curation.allowed_categories.includes(ai.category)) return `初审剔除：类型为${CATEGORY_LABELS[ai.category]}`;
  if (qualityOf(ai) < config.digest.filters.min_quality) return `初审剔除：质量分 ${qualityOf(ai)} 低于 ${config.digest.filters.min_quality}`;
  return null;
}

/** 没有引用、外链，正文去掉链接后不到这么多字：评审几次都给不出结果时按闲聊剔除，不再每次重试 */
const THIN_TEXT_LENGTH = 50;

export function isThin(t: RawTweet): boolean {
  return t.quoted === undefined && t.links.length === 0 && bodyLength(t) < THIN_TEXT_LENGTH;
}

export interface ReviewStats {
  kept: number;
  rejected: number;
  reviewed: number;
  failed: Array<{ id: string; error: string }>;
}

/**
 * 对候选推文逐条做 AI 评审（类型、去留、打分、摘要、翻译、媒体说明），并计算最终分。
 * strict 为 false（--skip-ai 试跑）时不按类型和去留过滤。
 */
export async function reviewCandidates(
  db: Db,
  config: AppConfig,
  candidates: TweetRow[],
  reviewer: Reviewer,
  opts: { strict: boolean; concurrency?: number; articles?: Map<string, LinkDigest> },
): Promise<ReviewStats> {
  const concurrency = opts.concurrency ?? 4;
  const stats: ReviewStats = { kept: 0, rejected: 0, reviewed: 0, failed: [] };
  const topicById = new Map(config.topics.map((t) => [t.id, t]));

  await mapLimit(candidates, concurrency, async (row) => {
    const allowed = (config.accountTopics.get(row.handle) ?? []).map((id) => topicById.get(id)!).map((t) => ({ id: t.id, name: t.name }));
    if (allowed.length === 0) return;
    try {
      const ai = await reviewer.review(row.raw, allowed, opts.articles?.get(row.id));
      const rejectReason = gate(ai, config, opts.strict);
      if (rejectReason) stats.rejected++;
      else stats.kept++;
      await db
        .update(tweets)
        .set({
          status: rejectReason ? "rejected" : "scored",
          filterReason: rejectReason,
          ai,
          topicId: ai.topicId,
          finalScore: finalScore(qualityOf(ai), row.ruleScore ?? 0, row.kind, config.digest.media_weight, accountWeight(config.digest.account_weight, row.handle)),
          processedAt: new Date(),
        })
        .where(eq(tweets.id, row.id));
      stats.reviewed++;
    } catch (e) {
      const error = (e as Error).message;
      // 只有一两个词的推文，模型常常不知道怎么填评审结果（格式不符），重试也没用
      if (opts.strict && isThin(row.raw) && error.startsWith("评审结果格式不符")) {
        stats.rejected++;
        await db
          .update(tweets)
          .set({ status: "rejected", filterReason: `初审剔除：${DROP_REASON_LABELS.chitchat}（内容过短，评审给不出结果）`, processedAt: new Date() })
          .where(eq(tweets.id, row.id));
        return;
      }
      stats.failed.push({ id: row.id, error });
      await db.update(tweets).set({ status: "failed", filterReason: error.slice(0, 500), processedAt: new Date() }).where(eq(tweets.id, row.id));
    }
  });
  return stats;
}
