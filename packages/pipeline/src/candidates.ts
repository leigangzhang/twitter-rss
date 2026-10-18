import { type AppConfig, median, ruleScore } from "@xrss/core";
import { type Db, tweets, type TweetRow } from "@xrss/core/db";
import { and, eq, gte, inArray } from "drizzle-orm";

const BASELINE_DAYS = 30;

/**
 * 给窗口内的新推文计算规则分（相对作者近 30 天互动中位数），
 * 然后每个主题取规则分最高的 N 条，作为送给 AI 的候选。
 */
export async function pickCandidates(db: Db, config: AppConfig, since: Date, now = new Date()): Promise<TweetRow[]> {
  const fresh = await db
    .select()
    .from(tweets)
    .where(and(eq(tweets.status, "new"), gte(tweets.createdAt, since), inArray(tweets.handle, config.accounts)));
  if (fresh.length === 0) return [];

  const handles = [...new Set(fresh.map((t) => t.handle))];
  const history = await db
    .select({ handle: tweets.handle, engagement: tweets.engagement })
    .from(tweets)
    .where(and(inArray(tweets.handle, handles), gte(tweets.createdAt, new Date(now.getTime() - BASELINE_DAYS * 86_400_000))));
  const baseline = new Map<string, number>();
  for (const h of handles) baseline.set(h, median(history.filter((r) => r.handle === h).map((r) => r.engagement)));

  for (const t of fresh) {
    t.ruleScore = ruleScore(t.raw, baseline.get(t.handle) ?? 0);
    await db.update(tweets).set({ ruleScore: t.ruleScore }).where(eq(tweets.id, t.id));
  }

  const chosen = new Map<string, TweetRow>();
  for (const topic of config.topics) {
    fresh
      .filter((t) => config.accountTopics.get(t.handle)?.includes(topic.id))
      .sort((a, b) => (b.ruleScore ?? 0) - (a.ruleScore ?? 0))
      .slice(0, config.digest.digest.candidates_per_topic)
      .forEach((t) => chosen.set(t.id, t));
  }
  return [...chosen.values()];
}
