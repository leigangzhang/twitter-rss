import { type AiResult, type AppConfig, qualityOf } from "@xrss/core";
import { accounts, type Db, tweets } from "@xrss/core/db";
import { gte, isNotNull, and } from "drizzle-orm";

/**
 * 账号分档：
 * good 优质（保留率高，每次都采）/ normal 普通 / poor 低质（少采）/
 * inactive 不活跃（很久没发推，按低质频率采）/ unrated 样本不足（按普通处理）
 */
export type AccountTier = "good" | "normal" | "poor" | "inactive" | "unrated";

export const TIER_LABELS: Record<AccountTier, string> = {
  good: "优质",
  normal: "普通",
  poor: "低质",
  inactive: "不活跃",
  unrated: "样本不足",
};

export interface AccountQuality {
  handle: string;
  tier: AccountTier;
  /** 统计期内 AI 评审过的推文数 */
  reviewed: number;
  /** 其中 AI 判为保留的 */
  kept: number;
  keepRate: number | null;
  /** 评审过的推文平均分（5 分制） */
  avgQuality: number | null;
  lastTweetAt: Date | null;
  /** 这一档的采集间隔（小时） */
  intervalHours: number;
  /** 样本足够且保留率极低：建议从 topics.yaml 移出 */
  suggestRemove: boolean;
}

export interface ReviewedRow {
  handle: string;
  status: string;
  ai: AiResult | null;
}

/** 规则分试跑（--skip-ai）留下的结果不是真实评审，不计入 */
const isRealReview = (ai: AiResult | null): ai is AiResult => Boolean(ai) && !(ai!.category === "other" && ai!.verdict === "keep");

/** AI 判为保留：初审 keep（终审去重剔除的也算，说明内容本身不错）；旧数据没有 verdict 时看是否通过 */
const isKept = (r: ReviewedRow) => (r.ai?.verdict ? r.ai.verdict === "keep" : r.status === "scored");

/** 按评审记录给账号分档（纯函数，便于测试） */
export function rateAccounts(
  config: Pick<AppConfig, "accounts" | "crawl">,
  rows: ReviewedRow[],
  profiles: Map<string, { lastTweetAt: Date | null }>,
  now = new Date(),
): Map<string, AccountQuality> {
  const q = config.crawl.account_quality;
  const byHandle = new Map<string, ReviewedRow[]>();
  for (const r of rows) {
    if (!isRealReview(r.ai)) continue;
    byHandle.set(r.handle, [...(byHandle.get(r.handle) ?? []), r]);
  }

  const result = new Map<string, AccountQuality>();
  for (const handle of config.accounts) {
    const list = byHandle.get(handle) ?? [];
    const kept = list.filter(isKept).length;
    const keepRate = list.length ? kept / list.length : null;
    const avgQuality = list.length ? Math.round((list.reduce((s, r) => s + qualityOf(r.ai), 0) / list.length) * 10) / 10 : null;
    const lastTweetAt = profiles.get(handle)?.lastTweetAt ?? null;

    let tier: AccountTier;
    if (lastTweetAt && now.getTime() - lastTweetAt.getTime() > q.inactive_days * 86_400_000) tier = "inactive";
    else if (list.length < q.min_samples || keepRate === null) tier = "unrated";
    else if (keepRate >= q.good_keep_rate) tier = "good";
    else if (keepRate < q.poor_keep_rate) tier = "poor";
    else tier = "normal";

    const intervalHours = tier === "good" ? q.interval_hours.good : tier === "poor" || tier === "inactive" ? q.interval_hours.poor : q.interval_hours.normal;
    result.set(handle, {
      handle,
      tier,
      reviewed: list.length,
      kept,
      keepRate,
      avgQuality,
      lastTweetAt,
      intervalHours,
      suggestRemove: list.length >= q.suggest_remove.min_samples && (keepRate ?? 1) < q.suggest_remove.max_keep_rate,
    });
  }
  return result;
}

export async function loadAccountQuality(db: Db, config: AppConfig, now = new Date()): Promise<Map<string, AccountQuality>> {
  const since = new Date(now.getTime() - config.crawl.account_quality.stats_days * 86_400_000);
  const rows = await db
    .select({ handle: tweets.handle, status: tweets.status, ai: tweets.ai })
    .from(tweets)
    .where(and(isNotNull(tweets.ai), gte(tweets.createdAt, since)));
  const profiles = new Map((await db.select({ handle: accounts.handle, lastTweetAt: accounts.lastTweetAt }).from(accounts)).map((a) => [a.handle, a]));
  return rateAccounts(config, rows, profiles, now);
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

/** 账号质量表（Markdown），用于精选报告和 pnpm accounts */
export function renderAccountReport(quality: Map<string, AccountQuality>, config: Pick<AppConfig, "crawl">): string {
  const list = [...quality.values()];
  const order: AccountTier[] = ["good", "normal", "unrated", "poor", "inactive"];
  const counts = order.map((t) => `${TIER_LABELS[t]} ${list.filter((a) => a.tier === t).length}`).join("，");
  const q = config.crawl.account_quality;
  const lines = [
    `近 ${q.stats_days} 天：${counts}。优质每 ${q.interval_hours.good} 小时、普通每 ${q.interval_hours.normal} 小时、低质和不活跃每 ${q.interval_hours.poor} 小时采集一次。`,
    "",
    "| 账号 | 档位 | 评审 | 保留 | 保留率 | 平均分 |",
    "|---|---|---|---|---|---|",
    ...list
      .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || (b.keepRate ?? -1) - (a.keepRate ?? -1) || b.reviewed - a.reviewed)
      .map((a) => `| @${a.handle} | ${TIER_LABELS[a.tier]}${a.suggestRemove ? " ⚠" : ""} | ${a.reviewed} | ${a.kept} | ${pct(a.keepRate)} | ${a.avgQuality ?? "—"} |`),
  ];
  const remove = list.filter((a) => a.suggestRemove);
  if (remove.length) {
    lines.push(
      "",
      `⚠ 建议从 config/topics.yaml 移出（近 ${q.stats_days} 天评审 ≥ ${q.suggest_remove.min_samples} 条，保留率 < ${pct(q.suggest_remove.max_keep_rate)}）：${remove.map((a) => `@${a.handle}`).join("、")}`,
    );
  }
  return lines.join("\n");
}
