import { type AppConfig, finalScore } from "@xrss/core";
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

export interface ReviewStats {
  reviewed: number;
  failed: Array<{ id: string; error: string }>;
}

/** 对候选推文逐条做 AI 评审（打分、选主题、翻译、媒体说明），并计算最终分 */
export async function reviewCandidates(db: Db, config: AppConfig, candidates: TweetRow[], reviewer: Reviewer, concurrency = 4): Promise<ReviewStats> {
  const stats: ReviewStats = { reviewed: 0, failed: [] };
  const topicById = new Map(config.topics.map((t) => [t.id, t]));

  await mapLimit(candidates, concurrency, async (row) => {
    const allowed = (config.accountTopics.get(row.handle) ?? []).map((id) => topicById.get(id)!).map((t) => ({ id: t.id, name: t.name }));
    if (allowed.length === 0) return;
    try {
      const ai = await reviewer.review(row.raw, allowed);
      await db
        .update(tweets)
        .set({
          status: "scored",
          ai,
          topicId: ai.topicId,
          finalScore: finalScore(ai.quality, row.ruleScore ?? 0, row.kind, config.digest.media_weight),
          processedAt: new Date(),
        })
        .where(eq(tweets.id, row.id));
      stats.reviewed++;
    } catch (e) {
      const error = (e as Error).message;
      stats.failed.push({ id: row.id, error });
      await db.update(tweets).set({ status: "failed", filterReason: error.slice(0, 500), processedAt: new Date() }).where(eq(tweets.id, row.id));
    }
  });
  return stats;
}
