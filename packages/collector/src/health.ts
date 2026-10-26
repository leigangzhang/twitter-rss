import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CrawlConfig, findRepoRoot, type InboxFile } from "@xrss/core";

/**
 * 采集健康状态：记录每次采集的用量、出现过的异常和冷却期。
 * 保存在 data/crawl-state.json，由 pnpm plan（检查能否采集）和 parse（记录结果）读写。
 */
export interface CrawlState {
  /** 冷却期结束时间（ISO）；在此之前不安排采集 */
  cooldownUntil: string | null;
  /** 需要人工处理（如登录失效），处理后运行 pnpm crawl:reset */
  manualHold: { since: string; reason: string } | null;
  /** 连续出现异常的次数，用于冷却期加倍；一次正常采集后清零 */
  consecutiveIncidents: number;
  incidents: Array<{ at: string; date: string; handle: string; status: InboxFile["status"]; error?: string; cooldownHours: number | "manual" }>;
  runs: Array<{ date: string; accounts: number; timelinePages: number; detailPages: number; blocked: number; recordedAt: string }>;
}

export const EMPTY_STATE: CrawlState = { cooldownUntil: null, manualHold: null, consecutiveIncidents: 0, incidents: [], runs: [] };

export function statePath(): string {
  return join(findRepoRoot(), "data", "crawl-state.json");
}

export function loadState(path = statePath()): CrawlState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE);
  return { ...structuredClone(EMPTY_STATE), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<CrawlState>) };
}

export function saveState(state: CrawlState, path = statePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** 本地时间（按时区）的小时数 */
function localHour(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now)) % 24;
}

export type Gate = { ok: true } | { ok: false; reason: string; until?: string };

/** 现在能否采集：人工暂停、冷却期、活跃时段 */
export function checkGate(state: CrawlState, crawl: CrawlConfig, timeZone: string, now = new Date()): Gate {
  if (state.manualHold) {
    return { ok: false, reason: `需要人工处理：${state.manualHold.reason}。处理后运行 pnpm crawl:reset` };
  }
  if (state.cooldownUntil && new Date(state.cooldownUntil) > now) {
    return { ok: false, reason: "上次采集遇到限制，正在冷却", until: state.cooldownUntil };
  }
  const [start, end] = crawl.active_hours;
  const hour = localHour(now, timeZone);
  if (!(hour >= start && hour < end)) {
    return { ok: false, reason: `当前 ${hour} 点不在允许采集的时段（${start}–${end} 点）` };
  }
  return { ok: true };
}

/** 某种异常对应的基础冷却时长 */
function baseCooldown(status: InboxFile["status"], crawl: CrawlConfig): number | "manual" {
  switch (status) {
    case "rate_limited":
      return crawl.cooldown.rate_limited_hours;
    case "captcha":
      return crawl.cooldown.captcha_hours;
    case "login_required":
      return crawl.cooldown.login_required;
    case "error":
      return crawl.cooldown.error_hours;
    default:
      return 0;
  }
}

export interface RunSummary {
  date: string;
  files: Array<Pick<InboxFile, "handle" | "status" | "error">>;
  timelinePages: number;
  detailPages: number;
}

/**
 * 记录一次采集结果。同一天多次记录（parse 会在补抓前后各运行一次）以最后一次为准，
 * 同一天同一账号的同一种异常只算一次。
 * 出现异常时设置冷却期：限流、验证码按 基础时长 × 倍数^(连续次数-1) 递增，不超过上限；
 * 其他异常（error，多半是页面没加载出来）固定用基础时长，不递增，避免一次偶发失败连带跳过第二天；登录失效改为人工暂停。
 */
export function recordRun(state: CrawlState, run: RunSummary, crawl: CrawlConfig, now = new Date()): CrawlState {
  const next = structuredClone(state);
  // 账号不存在（not_found）只影响这一个账号，不算异常、不冷却
  const blocked = run.files.filter((f) => f.status !== "ok" && f.status !== "not_found");

  next.runs = [
    ...next.runs.filter((r) => r.date !== run.date),
    {
      date: run.date,
      accounts: run.files.length,
      timelinePages: run.timelinePages,
      detailPages: run.detailPages,
      blocked: blocked.length,
      recordedAt: now.toISOString(),
    },
  ].slice(-60);

  const fresh = blocked.filter((b) => !next.incidents.some((i) => i.date === run.date && i.handle === b.handle && i.status === b.status));
  if (fresh.length === 0) {
    if (blocked.length === 0) next.consecutiveIncidents = 0;
    return next;
  }

  next.consecutiveIncidents += 1;
  let longest = 0;
  for (const b of fresh) {
    const base = baseCooldown(b.status, crawl);
    if (base === "manual") {
      next.manualHold = { since: now.toISOString(), reason: `@${b.handle} 采集时提示需要重新登录` };
      next.incidents.push({ at: now.toISOString(), date: run.date, handle: b.handle, status: b.status, error: b.error, cooldownHours: "manual" });
      continue;
    }
    const escalate = b.status === "rate_limited" || b.status === "captcha";
    const hours = Math.min(escalate ? base * crawl.cooldown.backoff_multiplier ** (next.consecutiveIncidents - 1) : base, crawl.cooldown.max_hours);
    longest = Math.max(longest, hours);
    next.incidents.push({ at: now.toISOString(), date: run.date, handle: b.handle, status: b.status, error: b.error, cooldownHours: hours });
  }
  if (longest > 0) {
    const until = new Date(now.getTime() + longest * 3_600_000);
    if (!next.cooldownUntil || new Date(next.cooldownUntil) < until) next.cooldownUntil = until.toISOString();
  }
  next.incidents = next.incidents.slice(-100);
  return next;
}

/** 人工确认账号正常后解除暂停和冷却 */
export function resetState(state: CrawlState): CrawlState {
  return { ...structuredClone(state), cooldownUntil: null, manualHold: null, consecutiveIncidents: 0 };
}
