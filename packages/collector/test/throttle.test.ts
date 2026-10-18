import { join } from "node:path";
import { loadConfig } from "@xrss/core";
import { describe, expect, it } from "vitest";
import { scheduleDetails } from "../src/details.ts";
import { checkGate, EMPTY_STATE, recordRun, resetState } from "../src/health.ts";
import { makePlan } from "../src/plan.ts";
import { createRandom } from "../src/random.ts";

const base = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const config = {
  ...base,
  accounts: ["a", "b", "c", "d", "e"],
  accountTopics: new Map(["a", "b", "c", "d", "e"].map((h) => [h, ["ai"]])),
  crawl: { ...base.crawl, budget: { ...base.crawl.budget, max_accounts_per_run: 3, max_page_loads_per_run: 10, max_detail_per_run: 5 } },
};
const crawl = config.crawl;
// 北京时间 2026-10-19 07:00
const morning = new Date("2026-10-18T23:00:00Z");

describe("采集清单的节流", () => {
  it("按最久没采集优先、超出预算的延后，并预先排好随机节奏", () => {
    const known = new Map([
      ["a", { lastSeenId: null, lastCollectedAt: new Date("2026-10-17T22:00:00Z") }],
      ["b", { lastSeenId: null, lastCollectedAt: new Date("2026-10-18T20:00:00Z") }], // 3 小时前刚采过
      ["c", { lastSeenId: null, lastCollectedAt: new Date("2026-10-16T22:00:00Z") }],
      ["d", { lastSeenId: null, lastCollectedAt: null }],
      ["e", { lastSeenId: null, lastCollectedAt: new Date("2026-10-17T23:00:00Z") }],
    ]);
    const plan = makePlan({ config, state: EMPTY_STATE, known, now: morning, seed: 42 });
    expect(plan.skip).toBeNull();
    expect(plan.accounts.map((a) => a.handle).sort()).toEqual(["a", "c", "d"]);
    expect(plan.deferred).toEqual([
      { handle: "b", reason: "距上次采集不足 20 小时" },
      { handle: "e", reason: "超出本次预算，下次优先安排" },
    ]);
    expect(plan.budget).toEqual({ maxPageLoads: 10, maxDetail: 5 });
    expect(plan.accounts[0]!.waitBeforeSec).toBe(0);
    for (const a of plan.accounts.slice(1)) {
      expect(a.waitBeforeSec).toBeGreaterThanOrEqual(crawl.pacing.account_delay_sec[0]);
      expect(a.waitBeforeSec).toBeLessThanOrEqual(crawl.pacing.account_delay_sec[1]);
    }
    for (const a of plan.accounts) {
      expect(a.scrollPausesMs).toHaveLength(crawl.budget.max_scrolls_per_account);
      for (const ms of a.scrollPausesMs) expect(ms).toBeGreaterThanOrEqual(crawl.pacing.scroll_pause_ms[0]);
    }
    expect(plan.startDelaySec).toBeLessThanOrEqual(crawl.start_jitter_min[1] * 60 + 59);
  });

  it("同一种子生成相同清单，不同种子顺序不同", () => {
    const known = new Map();
    const a = makePlan({ config, state: EMPTY_STATE, known, now: morning, seed: 1 });
    const b = makePlan({ config, state: EMPTY_STATE, known, now: morning, seed: 1 });
    expect(a).toEqual(b);
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => makePlan({ config, state: EMPTY_STATE, known, now: morning, seed }).accounts.map((x) => x.handle).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("不在允许时段时不安排采集", () => {
    const night = new Date("2026-10-18T17:00:00Z"); // 北京时间凌晨 1 点
    const plan = makePlan({ config, state: EMPTY_STATE, known: new Map(), now: night });
    expect(plan.skip?.reason).toContain("不在允许采集的时段");
    expect(plan.accounts).toEqual([]);
  });
});

describe("熔断与冷却", () => {
  const run = (status: "ok" | "rate_limited" | "captcha" | "login_required", date = "2026-10-19") => ({
    date,
    files: [
      { handle: "a", status: "ok" as const },
      { handle: "b", status },
    ],
    timelinePages: 2,
    detailPages: 0,
  });

  it("限流后进入冷却，冷却期内不安排采集；连续出事冷却加倍", () => {
    const s1 = recordRun(EMPTY_STATE, run("rate_limited"), crawl, morning);
    expect(s1.consecutiveIncidents).toBe(1);
    expect(s1.cooldownUntil).toBe(new Date(morning.getTime() + 24 * 3_600_000).toISOString());
    expect(checkGate(s1, crawl, "Asia/Shanghai", new Date(morning.getTime() + 3_600_000)).ok).toBe(false);

    // 同一天重复记录不算新的事故
    expect(recordRun(s1, run("rate_limited"), crawl, morning).consecutiveIncidents).toBe(1);

    const later = new Date(morning.getTime() + 25 * 3_600_000);
    const s2 = recordRun(s1, run("rate_limited", "2026-10-20"), crawl, later);
    expect(s2.consecutiveIncidents).toBe(2);
    expect(s2.cooldownUntil).toBe(new Date(later.getTime() + 48 * 3_600_000).toISOString());
  });

  it("正常采集一次后清零；冷却期有上限", () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < 6; i++) s = recordRun(s, run("captcha", `2026-10-${20 + i}`), crawl, morning);
    expect(s.cooldownUntil).toBe(new Date(morning.getTime() + crawl.cooldown.max_hours * 3_600_000).toISOString());
    expect(recordRun(s, run("ok", "2026-10-30"), crawl, morning).consecutiveIncidents).toBe(0);
  });

  it("登录失效需要人工处理，crawl:reset 后恢复", () => {
    const s = recordRun(EMPTY_STATE, run("login_required"), crawl, morning);
    expect(s.manualHold?.reason).toContain("@b");
    const gate = checkGate(s, crawl, "Asia/Shanghai", morning);
    expect(gate.ok).toBe(false);
    expect(checkGate(resetState(s), crawl, "Asia/Shanghai", morning).ok).toBe(true);
  });
});

describe("详情页补抓预算", () => {
  it("按互动量优先、超出预算的不安排，同一账号尽量不连续", () => {
    const c = (id: string, handle: string, engagement: number) => ({ id, handle, engagement, url: `https://x.com/${handle}/status/${id}`, reason: "truncated" as const });
    const { scheduled, overBudget } = scheduleDetails([c("1", "a", 10), c("2", "a", 50), c("3", "a", 40), c("4", "b", 30), c("5", "b", 1)], 3, crawl, createRandom(7));
    expect(scheduled.map((s) => s.id)).toEqual(["2", "4", "3"]);
    expect(overBudget.map((s) => s.id)).toEqual(["1", "5"]);
    for (const s of scheduled) {
      expect(s.waitBeforeSec).toBeGreaterThanOrEqual(crawl.pacing.detail_delay_sec[0]);
      expect(s.waitBeforeSec).toBeLessThanOrEqual(crawl.pacing.detail_delay_sec[1]);
    }
  });
});
