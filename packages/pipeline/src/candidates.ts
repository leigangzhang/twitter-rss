import { accountWeight, type AppConfig, median, ruleScore, type TimeRange } from "@xrss/core";
import { type Db, tweets, type TweetRow } from "@xrss/core/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { inBatch } from "./batch.ts";

const BASELINE_DAYS = 30;

/**
 * 给时间范围内的新推文计算规则分（相对作者近 30 天互动中位数），
 * 然后每个主题取规则分最高的 N 条，作为送给 AI 的候选。
 * N（candidates_per_topic）是同一批次（同一天）的总数：已经送去评审过的（通过、剔除、失败）都算在内，
 * 同一天重跑时只补足到 N，不会每跑一次多挑 N 条。
 * 上次评审失败的（比如密钥失效、接口超时）总是重新放进来，否则会一直停在 failed 不再评审；它们已经算过名额，不重复占用。
 */
export async function pickCandidates(db: Db, config: AppConfig, range: TimeRange): Promise<TweetRow[]> {
  const fresh = await db
    .select()
    .from(tweets)
    .where(and(inArray(tweets.status, ["new", "failed"]), inBatch(range), inArray(tweets.handle, config.accounts)));
  if (fresh.length === 0) return [];

  const handles = [...new Set(fresh.map((t) => t.handle))];
  const history = await db
    .select({ handle: tweets.handle, engagement: tweets.engagement })
    .from(tweets)
    .where(and(inArray(tweets.handle, handles), gte(tweets.createdAt, new Date(range.until.getTime() - BASELINE_DAYS * 86_400_000))));
  const baseline = new Map<string, number>();
  for (const h of handles) baseline.set(h, median(history.filter((r) => r.handle === h).map((r) => r.engagement)));

  for (const t of fresh) {
    t.ruleScore = ruleScore(t.raw, baseline.get(t.handle) ?? 0);
    await db.update(tweets).set({ ruleScore: t.ruleScore }).where(eq(tweets.id, t.id));
  }

  // 这一批次里已经送去评审过的推文（含失败的），按账号所属主题占用名额
  const entered = await db
    .select({ handle: tweets.handle })
    .from(tweets)
    .where(and(inArray(tweets.status, ["scored", "rejected", "failed"]), inBatch(range), inArray(tweets.handle, config.accounts)));
  const inTopic = (handle: string, topicId: string) => config.accountTopics.get(handle)?.includes(topicId) ?? false;
  // 降权的账号在名额有限时排在后面
  const rank = (t: TweetRow) => (t.ruleScore ?? 0) * accountWeight(config.digest.account_weight, t.handle);

  const chosen = new Map<string, TweetRow>();
  for (const t of fresh) if (t.status === "failed") chosen.set(t.id, t);
  for (const topic of config.topics) {
    const left = config.digest.digest.candidates_per_topic - entered.filter((r) => inTopic(r.handle, topic.id)).length;
    if (left <= 0) continue;
    fresh
      .filter((t) => t.status === "new" && inTopic(t.handle, topic.id))
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, left)
      .forEach((t) => chosen.set(t.id, t));
  }
  return [...chosen.values()];
}
