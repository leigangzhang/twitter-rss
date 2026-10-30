import { join } from "node:path";
import { loadConfig } from "@xrss/core";
import { describe, expect, it } from "vitest";
import { scheduleDetails } from "../src/details.ts";
import { checkGate, EMPTY_STATE, recordRun, resetState } from "../src/health.ts";
import { makePlan } from "../src/plan.ts";
import { type AccountTier, crawlEveryDays, daysToHours, rateAccounts, renderAccountReport } from "../src/quality.ts";
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
  it("按采集间隔决定是否到期，攒下合格内容最多的优先，超出预算的延后，并预先排好随机节奏", () => {
    const known = new Map([
      ["a", { lastSeenId: null, lastCollectedAt: new Date("2026-10-17T22:00:00Z") }], // 25 小时前，优质（20 小时）→ 到期
      ["b", { lastSeenId: null, lastCollectedAt: new Date("2026-10-18T20:00:00Z") }], // 3 小时前刚采过
      ["c", { lastSeenId: null, lastCollectedAt: new Date("2026-10-16T22:00:00Z") }], // 49 小时前，没有质量数据 → 到期，但攒下的少
      ["d", { lastSeenId: null, lastCollectedAt: null }], // 从没采过 → 最先
      ["e", { lastSeenId: null, lastCollectedAt: new Date("2026-10-17T23:00:00Z") }], // 24 小时前，低质（68 小时）→ 没到时间
    ]);
    const tier = (handle: string, t: AccountTier, intervalHours: number) =>
      [
        handle,
        {
          handle,
          tier: t,
          intervalHours,
          crawlEveryDays: 1 + (intervalHours - 20) / 24,
          keptPerDay: t === "good" ? 1.5 : 0.2,
          reviewed: 10,
          kept: 1,
          keepRate: 0.1,
          smoothedRate: 0.17,
          avgQuality: 2,
          lastTweetAt: null,
          suggestRemove: false,
        },
      ] as const;
    const quality = new Map([tier("a", "good", 20), tier("b", "good", 20), tier("e", "poor", 68)]);
    const small = { ...config, crawl: { ...crawl, budget: { ...crawl.budget, max_accounts_per_run: 2 } } };
    const plan = makePlan({ config: small, state: EMPTY_STATE, known, quality, now: morning, seed: 42 });
    expect(plan.skip).toBeNull();
    expect(plan.accounts.map((a) => a.handle).sort()).toEqual(["a", "d"]);
    expect(plan.accounts.find((a) => a.handle === "a")!.tier).toBe("good");
    expect(plan.deferred).toEqual([
      { handle: "b", reason: "优质账号（每天约 1.5 条合格），每 20 小时采集一次，还没到时间" },
      { handle: "e", reason: "低质账号（每天约 0.2 条合格），每 68 小时采集一次，还没到时间" },
      { handle: "c", reason: "超出本次预算，下次优先安排（内容会补收）" },
    ]);
  });

  it("每个账号的补收起点：上次覆盖到的时间点，最多往回 catch_up_days 天", () => {
    const known = new Map([
      ["a", { lastSeenId: null, lastCollectedAt: new Date("2026-10-16T22:00:00Z"), coveredUntil: new Date("2026-10-16T16:00:00Z") }],
      ["c", { lastSeenId: null, lastCollectedAt: new Date("2026-10-08T22:00:00Z"), coveredUntil: new Date("2026-10-08T16:00:00Z") }],
      ["d", { lastSeenId: null, lastCollectedAt: null, coveredUntil: null }],
    ]);
    const plan = makePlan({ config: { ...config, accounts: ["a", "c", "d"] }, state: EMPTY_STATE, known, now: morning, seed: 1 });
    const since = Object.fromEntries(plan.accounts.map((a) => [a.handle, a.since]));
    expect(plan.since).toBe("2026-10-17T16:00:00.000Z");
    expect(since.a).toBe("2026-10-16T16:00:00.000Z"); // 补收 10 月 17 日
    expect(since.c).toBe("2026-10-13T16:00:00.000Z"); // 最多往回 catch_up_days（5）天
    expect(since.d).toBe("2026-10-17T16:00:00.000Z"); // 第一次采集只收前一天
  });

  it("预算和随机节奏", () => {
    const known = new Map([
      ["a", { lastSeenId: null, lastCollectedAt: null }],
      ["c", { lastSeenId: null, lastCollectedAt: null }],
      ["d", { lastSeenId: null, lastCollectedAt: null }],
    ]);
    const plan = makePlan({ config: { ...config, accounts: ["a", "c", "d"] }, state: EMPTY_STATE, known, now: morning, seed: 42 });
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
  const run = (status: "ok" | "rate_limited" | "captcha" | "login_required" | "error" | "not_found", date = "2026-10-19") => ({
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

  it("其他异常（error）冷却不随连续次数加倍；账号不存在不算异常", () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < 3; i++) s = recordRun(s, run("error", `2026-10-${20 + i}`), crawl, morning);
    expect(s.consecutiveIncidents).toBe(3);
    expect(s.cooldownUntil).toBe(new Date(morning.getTime() + crawl.cooldown.error_hours * 3_600_000).toISOString());

    const n = recordRun(EMPTY_STATE, run("not_found"), crawl, morning);
    expect(n.incidents).toEqual([]);
    expect(n.cooldownUntil).toBeNull();
    expect(n.consecutiveIncidents).toBe(0);
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

describe("账号质量分档", () => {
  const cfg = { accounts: ["good", "poor", "few", "none", "quiet"], crawl: base.crawl };
  const review = (handle: string, keep: boolean) => ({
    handle,
    status: keep ? "scored" : "rejected",
    ai: { verdict: keep ? "keep" : "drop", category: keep ? "best_practice" : "other", dropReason: keep ? null : "shallow", quality: keep ? 4 : 1, scale: 5, topicId: "ai", summary: "", reason: "", zh: null, mediaNote: null } as const,
  });
  const rows = [
    ...Array.from({ length: 28 }, (_, i) => review("good", i < 20)),
    ...Array.from({ length: 25 }, (_, i) => review("poor", i < 1)),
    ...Array.from({ length: 2 }, () => review("few", true)),
    ...Array.from({ length: 10 }, () => review("quiet", true)),
  ];
  const now = new Date("2026-10-19T00:00:00Z");
  const profiles = new Map([["quiet", { lastTweetAt: new Date("2026-09-20T00:00:00Z") }]]);
  const q = rateAccounts(cfg, rows, profiles, now);

  it("按平滑保留率分优质 / 低质，按每天合格条数排间隔；没有评审记录、很久没发推的按最长间隔", () => {
    expect(q.get("good")).toMatchObject({ tier: "good", reviewed: 28, kept: 20, crawlEveryDays: 1, intervalHours: 20 });
    expect(q.get("good")!.smoothedRate).toBeCloseTo(21.5 / 33);
    expect(q.get("good")!.keptPerDay).toBeCloseTo(((21.5 / 33) * 28) / 14);
    expect(q.get("poor")).toMatchObject({ tier: "poor", keepRate: 0.04, crawlEveryDays: 4, intervalHours: 92, suggestRemove: true });
    expect(q.get("none")).toMatchObject({ tier: "unrated", reviewed: 0, smoothedRate: null, intervalHours: 92, suggestRemove: false });
    expect(q.get("quiet")).toMatchObject({ tier: "inactive", intervalHours: 92 });
  });

  it("报告列出分档和建议移出的账号", () => {
    const report = renderAccountReport(q, cfg);
    expect(report).toContain("优质 2");
    expect(report).toContain("平滑保留率");
    expect(report).toContain("建议从 config/topics.yaml 移出");
    expect(report).toContain("@poor");
  });

  it("评审少的账号要连续通过才能升档：2/2 为优质，1/1 和 5/10 为普通", () => {
    expect(q.get("few")).toMatchObject({ tier: "good", keepRate: 1 });
    const one = rateAccounts({ accounts: ["one", "half"], crawl: base.crawl }, [review("one", true), ...Array.from({ length: 10 }, (_, i) => review("half", i < 5))], new Map(), now);
    expect(one.get("one")).toMatchObject({ tier: "normal", keepRate: 1 });
    expect(one.get("half")).toMatchObject({ tier: "normal", keepRate: 0.5 });
  });

  it("采集间隔：约每攒够 1.2 条合格内容一次；低质至少隔天，官方号最多隔天，不活跃不受官方号限制", () => {
    const c = { crawl: { ...base.crawl, account_quality: { ...base.crawl.account_quality, schedule: { ...base.crawl.account_quality.schedule, fast_accounts: ["OpenAI"] } } } };
    expect(crawlEveryDays(c, "x", "good", 2)).toBe(1);
    expect(crawlEveryDays(c, "x", "good", 1.2)).toBe(1);
    expect(crawlEveryDays(c, "x", "normal", 0.8)).toBe(2);
    expect(crawlEveryDays(c, "x", "normal", 0.5)).toBe(3);
    expect(crawlEveryDays(c, "x", "good", 0.1)).toBe(4);
    expect(crawlEveryDays(c, "x", "poor", 3)).toBe(2);
    expect(crawlEveryDays(c, "openai", "good", 0.1)).toBe(2);
    expect(crawlEveryDays(c, "openai", "unrated", 0)).toBe(2);
    expect(crawlEveryDays(c, "openai", "inactive", 0)).toBe(4);
    expect(daysToHours(c, 4)).toBe(92);
  });
});
