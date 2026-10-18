import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, catchUpSince, type CrawlConfig, localDate, runRange } from "@xrss/core";
import { accounts, type Db } from "@xrss/core/db";
import { type CrawlState, checkGate } from "./health.ts";
import { inboxDir } from "./paths.ts";
import { type AccountQuality, type AccountTier, loadAccountQuality, TIER_LABELS } from "./quality.ts";
import { createRandom, type Random } from "./random.ts";

export interface PlannedAccount {
  handle: string;
  url: string;
  topics: string[];
  /** 账号质量档位（决定采集频率） */
  tier: AccountTier;
  /**
   * 这个账号要收到哪个时间点为止（含）：上次没轮到的那几天也要补上，
   * 滚动到早于它的推文就停止。通常早于全局的 since。
   */
  since: string;
  /** 遇到这个 ID（或更早的推文）就停止滚动 */
  lastSeenId: string | null;
  /** 打开这个主页之前先等待的秒数（已随机化，直接照做） */
  waitBeforeSec: number;
  /** 不为 0 时，在等待之前先额外休息这么多秒 */
  longBreakBeforeSec: number;
  /** 每次向下滚动之前的停顿（毫秒），数组长度就是最多滚动次数 */
  scrollPausesMs: number[];
}

export interface CrawlPlan {
  date: string;
  /** 只采集 [since, until) 之间发布的推文（默认是前一天 0:00–24:00，北京时间） */
  since: string;
  until: string;
  /** 内容所属日期，例如 2026-10-17 */
  contentDate: string;
  /** 不为空时表示今天不采集（冷却期、人工暂停、不在允许时段），采集端什么都不要做 */
  skip: { reason: string; until?: string } | null;
  /** 开始采集前随机等待的秒数 */
  startDelaySec: number;
  budget: {
    /** 本次最多打开的页面数（主页 + 详情页），达到后立即结束采集 */
    maxPageLoads: number;
    /** 详情页补抓上限（具体清单在 parse 之后的 detail-needed.json 里） */
    maxDetail: number;
  };
  rules: {
    /** 遇到限流、登录失效或验证码时立即停止整个采集，不重试 */
    stopOnBlock: true;
  };
  accounts: PlannedAccount[];
  /** 本次没安排的账号及原因（会在之后的采集中优先安排） */
  deferred: Array<{ handle: string; reason: string }>;
  output: {
    dir: string;
    /** 每个账号一个文件 */
    file: "<handle>.json";
    schema: string;
  };
}

/** 每打开若干个页面插入一次长休息 */
export function createBreaker(crawl: CrawlConfig, rng: Random) {
  let untilBreak = rng.int(crawl.pacing.long_break_every);
  return () => {
    untilBreak -= 1;
    if (untilBreak > 0) return 0;
    untilBreak = rng.int(crawl.pacing.long_break_every);
    return rng.int(crawl.pacing.long_break_sec);
  };
}

export interface PlanInput {
  config: AppConfig;
  state: CrawlState;
  known: Map<string, { lastSeenId: string | null; lastCollectedAt: Date | null; coveredUntil?: Date | null }>;
  /** 账号质量分档；不传时都按"样本不足"（普通频率）处理 */
  quality?: Map<string, AccountQuality>;
  now?: Date;
  seed?: number;
}

/** 生成采集清单（纯函数，便于测试） */
export function makePlan({ config, state, known, quality, now = new Date(), seed }: PlanInput): CrawlPlan {
  const tz = config.digest.timezone;
  const crawl = config.crawl;
  const date = localDate(now, tz);
  const range = runRange(config, date, now);
  const rng = createRandom(seed);
  const dir = inboxDir(date);

  const base: CrawlPlan = {
    date,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    contentDate: range.contentDate,
    skip: null,
    startDelaySec: 0,
    budget: { maxPageLoads: crawl.budget.max_page_loads_per_run, maxDetail: crawl.budget.max_detail_per_run },
    rules: { stopOnBlock: true },
    accounts: [],
    deferred: [],
    output: { dir, file: "<handle>.json", schema: join(config.configDir, "..", "schemas", "inbox-file.schema.json") },
  };

  const gate = checkGate(state, crawl, tz, now);
  if (!gate.ok) return { ...base, skip: { reason: gate.reason, until: gate.until } };

  // 每个账号按质量档位决定采集间隔（优质每次都采、低质约 3 天一次）；
  // 到期的按"超期程度"排序（从没采过的最先），超出预算的留到下次，没轮到的内容下次补收
  const q = crawl.account_quality;
  const tierOf = (h: string): AccountTier => quality?.get(h)?.tier ?? "unrated";
  const intervalOf = (h: string) => Math.max(crawl.min_interval_hours, quality?.get(h)?.intervalHours ?? q.interval_hours.normal);
  const hoursSince = (h: string) => {
    const last = known.get(h)?.lastCollectedAt;
    return last ? (now.getTime() - last.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
  };
  const deferred: CrawlPlan["deferred"] = [];
  const due = config.accounts.filter((h) => {
    if (hoursSince(h) >= intervalOf(h)) return true;
    deferred.push({ handle: h, reason: `${TIER_LABELS[tierOf(h)]}账号，每 ${intervalOf(h)} 小时采集一次，还没到时间` });
    return false;
  });
  const capacity = Math.min(crawl.budget.max_accounts_per_run, crawl.budget.max_page_loads_per_run);
  const overdue = (h: string) => hoursSince(h) / intervalOf(h);
  const ordered = [...due].sort((a, b) => overdue(b) - overdue(a) || a.localeCompare(b));
  for (const h of ordered.slice(capacity)) deferred.push({ handle: h, reason: "超出本次预算，下次优先安排（内容会补收）" });

  const breaker = createBreaker(crawl, rng);
  const selected = rng.shuffle(ordered.slice(0, capacity)).map((handle, i) => {
    const since = catchUpSince(range, known.get(handle)?.coveredUntil, crawl.catch_up_days);
    // 补收几天前的内容时多滚动几次（每多一天 +2 次，最多翻倍）
    const extraDays = Math.max(0, Math.ceil((range.since.getTime() - since.getTime()) / 86_400_000));
    const scrolls = Math.min(crawl.budget.max_scrolls_per_account * 2, crawl.budget.max_scrolls_per_account + extraDays * 2);
    return {
      handle,
      url: `https://x.com/${handle}`,
      topics: config.accountTopics.get(handle) ?? [],
      tier: tierOf(handle),
      since: since.toISOString(),
      lastSeenId: known.get(handle)?.lastSeenId ?? null,
      waitBeforeSec: i === 0 ? 0 : rng.int(crawl.pacing.account_delay_sec),
      longBreakBeforeSec: i === 0 ? 0 : breaker(),
      scrollPausesMs: Array.from({ length: scrolls }, () => rng.int(crawl.pacing.scroll_pause_ms)),
    };
  });

  return {
    ...base,
    startDelaySec: rng.int(crawl.start_jitter_min) * 60 + rng.int([0, 59]),
    budget: {
      maxPageLoads: crawl.budget.max_page_loads_per_run,
      maxDetail: Math.max(0, Math.min(crawl.budget.max_detail_per_run, crawl.budget.max_page_loads_per_run - selected.length)),
    },
    accounts: selected,
    deferred,
  };
}

export async function buildPlan(config: AppConfig, db: Db, state: CrawlState, now = new Date()): Promise<CrawlPlan> {
  const rows = await db.select().from(accounts);
  const known = new Map(rows.map((a) => [a.handle, { lastSeenId: a.lastSeenId, lastCollectedAt: a.lastCollectedAt, coveredUntil: a.coveredUntil }]));
  const quality = await loadAccountQuality(db, config, now);
  return makePlan({ config, state, known, quality, now });
}

export function writePlan(plan: CrawlPlan): string {
  mkdirSync(plan.output.dir, { recursive: true });
  const path = join(plan.output.dir, "plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}
