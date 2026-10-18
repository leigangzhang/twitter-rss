import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, type CrawlConfig, localDate, runRange } from "@xrss/core";
import { accounts, type Db } from "@xrss/core/db";
import { type CrawlState, checkGate } from "./health.ts";
import { inboxDir } from "./paths.ts";
import { createRandom, type Random } from "./random.ts";

export interface PlannedAccount {
  handle: string;
  url: string;
  topics: string[];
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
  known: Map<string, { lastSeenId: string | null; lastCollectedAt: Date | null }>;
  now?: Date;
  seed?: number;
}

/** 生成采集清单（纯函数，便于测试） */
export function makePlan({ config, state, known, now = new Date(), seed }: PlanInput): CrawlPlan {
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

  // 距上次采集太近的账号先跳过；其余按"最久没采集"排序，超出预算的留到下次
  const minGap = crawl.min_interval_hours * 3_600_000;
  const deferred: CrawlPlan["deferred"] = [];
  const eligible = config.accounts.filter((h) => {
    const last = known.get(h)?.lastCollectedAt;
    if (last && now.getTime() - last.getTime() < minGap) {
      deferred.push({ handle: h, reason: `距上次采集不足 ${crawl.min_interval_hours} 小时` });
      return false;
    }
    return true;
  });
  const capacity = Math.min(crawl.budget.max_accounts_per_run, crawl.budget.max_page_loads_per_run);
  const ordered = [...eligible].sort((a, b) => (known.get(a)?.lastCollectedAt?.getTime() ?? 0) - (known.get(b)?.lastCollectedAt?.getTime() ?? 0));
  for (const h of ordered.slice(capacity)) deferred.push({ handle: h, reason: "超出本次预算，下次优先安排" });

  const breaker = createBreaker(crawl, rng);
  const selected = rng.shuffle(ordered.slice(0, capacity)).map((handle, i) => ({
    handle,
    url: `https://x.com/${handle}`,
    topics: config.accountTopics.get(handle) ?? [],
    lastSeenId: known.get(handle)?.lastSeenId ?? null,
    waitBeforeSec: i === 0 ? 0 : rng.int(crawl.pacing.account_delay_sec),
    longBreakBeforeSec: i === 0 ? 0 : breaker(),
    scrollPausesMs: Array.from({ length: crawl.budget.max_scrolls_per_account }, () => rng.int(crawl.pacing.scroll_pause_ms)),
  }));

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
  const known = new Map(rows.map((a) => [a.handle, { lastSeenId: a.lastSeenId, lastCollectedAt: a.lastCollectedAt }]));
  return makePlan({ config, state, known, now });
}

export function writePlan(plan: CrawlPlan): string {
  mkdirSync(plan.output.dir, { recursive: true });
  const path = join(plan.output.dir, "plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}
