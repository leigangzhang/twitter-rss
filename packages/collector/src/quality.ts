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
  /** 平滑保留率（分档用，见 crawl.yaml 的 account_quality.prior_rate / prior_weight） */
  smoothedRate: number | null;
  /** 评审过的推文平均分（5 分制） */
  avgQuality: number | null;
  lastTweetAt: Date | null;
  /** 每天产出的合格内容（平滑保留率 × 统计期内平均每天评审的推文数） */
  keptPerDay: number;
  /** 几天采一次 */
  crawlEveryDays: number;
  /** 采集间隔（小时） */
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
/**
 * 采集间隔天数：大约每攒够 target_kept_per_crawl 条合格内容采一次，限制在 1 到 max_days 天；
 * 低质账号至少 poor_min_days 天，官方号（fast_accounts）最多 fast_max_days 天，不活跃和没有评审记录的按 max_days
 */
export function crawlEveryDays(config: Pick<AppConfig, "crawl">, handle: string, tier: AccountTier, keptPerDay: number): number {
  const s = config.crawl.account_quality.schedule;
  if (tier === "inactive") return s.max_days;
  let days = tier === "unrated" || keptPerDay <= 0 ? s.max_days : Math.min(s.max_days, Math.max(1, Math.ceil(s.target_kept_per_crawl / keptPerDay - 1e-9)));
  if (tier === "poor") days = Math.max(days, Math.min(s.poor_min_days, s.max_days));
  if (s.fast_accounts.some((a) => a.toLowerCase() === handle.toLowerCase())) days = Math.min(days, s.fast_max_days);
  return days;
}

export const daysToHours = (config: Pick<AppConfig, "crawl">, days: number) => config.crawl.min_interval_hours + 24 * (days - 1);

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
    const smoothedRate = list.length ? (kept + q.prior_rate * q.prior_weight) / (list.length + q.prior_weight) : null;
    const avgQuality = list.length ? Math.round((list.reduce((s, r) => s + qualityOf(r.ai), 0) / list.length) * 10) / 10 : null;
    const lastTweetAt = profiles.get(handle)?.lastTweetAt ?? null;

    let tier: AccountTier;
    if (lastTweetAt && now.getTime() - lastTweetAt.getTime() > q.inactive_days * 86_400_000) tier = "inactive";
    else if (list.length < q.min_samples || smoothedRate === null) tier = "unrated";
    else if (smoothedRate >= q.good_keep_rate) tier = "good";
    else if (smoothedRate < q.poor_keep_rate) tier = "poor";
    else tier = "normal";

    const keptPerDay = smoothedRate === null ? 0 : (smoothedRate * list.length) / q.stats_days;
    const everyDays = crawlEveryDays(config, handle, tier, keptPerDay);
    result.set(handle, {
      handle,
      tier,
      reviewed: list.length,
      kept,
      keepRate,
      smoothedRate,
      avgQuality,
      lastTweetAt,
      keptPerDay,
      crawlEveryDays: everyDays,
      intervalHours: daysToHours(config, everyDays),
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
    `近 ${q.stats_days} 天：${counts}。按每天产出的合格内容排采集间隔（约每攒够 ${q.schedule.target_kept_per_crawl} 条采一次，1–${q.schedule.max_days} 天），每天约需采 ${estimateDailyAccounts(list.map((a) => a.intervalHours), config)} 个账号。`,
    "",
    "| 账号 | 档位 | 评审 | 保留 | 保留率 | 平滑保留率 | 平均分 | 每天合格 | 几天采一次 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...list
      .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || (b.smoothedRate ?? -1) - (a.smoothedRate ?? -1) || b.reviewed - a.reviewed)
      .map((a) => `| @${a.handle} | ${TIER_LABELS[a.tier]}${a.suggestRemove ? " ⚠" : ""} | ${a.reviewed} | ${a.kept} | ${pct(a.keepRate)} | ${pct(a.smoothedRate)} | ${a.avgQuality ?? "—"} | ${a.keptPerDay.toFixed(1)} | ${a.crawlEveryDays} |`),
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

/**
 * 按各账号的采集间隔（小时）估算每天平均要采多少个账号；每天跑一次，间隔 20 小时算每天、44 小时算隔天。
 * 超过每天的上限（budget.max_accounts_per_run）时，各账号实际间隔会拉长。
 */
export function estimateDailyAccounts(intervals: number[], config: Pick<AppConfig, "crawl">): number {
  const days = (h: number) => Math.max(1, 1 + Math.ceil((h - config.crawl.min_interval_hours) / 24));
  return Math.round(intervals.reduce((sum, h) => sum + 1 / days(h), 0));
}

/** 预算提醒：账号多到轮一遍要超过补收天数（catch_up_days）、会漏内容时返回一句说明，否则 null */
export function budgetWarning(intervals: number[], config: Pick<AppConfig, "crawl">): string | null {
  const need = estimateDailyAccounts(intervals, config);
  const max = config.crawl.budget.max_accounts_per_run;
  const days = Math.ceil((intervals.length / max) * 10) / 10;
  if (need <= max || days <= config.crawl.catch_up_days) return null;
  return `${intervals.length} 个账号按采集间隔每天约需采 ${need} 个，超过每天上限 ${max} 个，每个账号平均约 ${days} 天才轮到一次，超过补收天数 ${config.crawl.catch_up_days} 天，部分内容会漏掉。可以调高 crawl.yaml 的 budget.max_accounts_per_run，或减少账号。`;
}
