import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CrawlPlan } from "../src/plan.ts";
import { addDetailSteps, completeStep, counts, currentStep, initProgress, isFinished, mergeDetailText, saveProgress, stopProgress, verifyStep } from "../src/runner.ts";

const fixture = readFileSync(join(import.meta.dirname, "fixtures", "user-tweets.json"), "utf8");
const date = "2026-10-19";
let dir = "";

const account = (handle: string, wait: number) => ({
  handle,
  url: `https://x.com/${handle}`,
  topics: [],
  tier: "unrated" as const,
  since: "2026-10-17T16:00:00.000Z",
  lastSeenId: null,
  waitBeforeSec: wait,
  longBreakBeforeSec: 0,
  scrollPausesMs: [1500, 2000],
});

const plan = (): CrawlPlan => ({
  date,
  since: "2026-10-17T16:00:00.000Z",
  until: "2026-10-18T16:00:00.000Z",
  contentDate: "2026-10-18",
  skip: null,
  startDelaySec: 300,
  budget: { maxPageLoads: 80, maxDetail: 25 },
  rules: { stopOnBlock: true },
  accounts: [account("mirachen_ml", 0), account("theopark", 12)],
  deferred: [],
  output: { dir: "", file: "<handle>.json", schema: "" },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xrss-run-"));
  process.env.INBOX_DIR = dir;
  mkdirSync(join(dir, date, "raw"), { recursive: true });
  writeFileSync(join(dir, date, "plan.json"), JSON.stringify(plan()));
});

describe("逐步采集", () => {
  it("第一步先等启动延迟，之后每步按清单的等待时间", () => {
    const now = new Date("2026-10-18T22:30:00Z");
    const p = initProgress(plan(), now);
    expect(p.nextAt).toBe("2026-10-18T22:35:00.000Z");
    expect(currentStep(p)!.key).toBe("mirachen_ml");
    completeStep(p, p.steps[0]!, "ok", new Date("2026-10-18T22:36:00Z"));
    expect(p.nextAt).toBe("2026-10-18T22:36:12.000Z");
    expect(currentStep(p)!.key).toBe("theopark");
  });

  it("没保存网络响应的账号不算完成；保存了才通过", () => {
    const p = initProgress(plan());
    const step = p.steps[0]!;
    expect(verifyStep(date, step, {})).toMatchObject({ ok: false });
    writeFileSync(join(dir, date, "raw", "mirachen_ml-1.json"), fixture);
    expect(verifyStep(date, step, {})).toMatchObject({ ok: true, message: "1 个响应文件，解析出 3 条推文" });
  });

  it("只有账号资料、或改写过的响应不算完成", () => {
    const p = initProgress(plan());
    writeFileSync(join(dir, date, "raw", "mirachen_ml-profile.json"), "{}");
    expect(verifyStep(date, p.steps[0]!, {}).message).toContain("没有时间线响应");
    writeFileSync(join(dir, date, "raw", "mirachen_ml-1.json"), "推文 1：……");
    expect(verifyStep(date, p.steps[0]!, {}).message).toContain("不是有效的 JSON");
  });

  it("拿不到网络响应时，要写好带头像的账号文件才能跳过", () => {
    const p = initProgress(plan());
    const step = p.steps[1]!;
    expect(verifyStep(date, step, { noResponse: "扩展读不到网络请求" }).ok).toBe(false);
    const file = { source: "t", collectedAt: "2026-10-18T22:40:00Z", handle: "theopark", status: "ok", tweets: [] };
    writeFileSync(join(dir, date, "theopark.json"), JSON.stringify(file));
    expect(verifyStep(date, step, { noResponse: "扩展读不到网络请求" }).message).toContain("profile.avatarUrl");
    writeFileSync(join(dir, date, "theopark.json"), JSON.stringify({ ...file, profile: { avatarUrl: "https://pbs.twimg.com/profile_images/1/a.jpg" } }));
    expect(verifyStep(date, step, { noResponse: "扩展读不到网络请求" }).ok).toBe(true);
  });

  it("没采完时不允许发送；采完、异常停止、今天不采集时允许", () => {
    expect(isFinished(date)).toMatchObject({ finished: false });
    const p = initProgress(plan());
    for (const s of p.steps) completeStep(p, s, "ok");
    saveProgress(p);
    expect(isFinished(date)).toMatchObject({ finished: false });
    p.phase = "finished";
    saveProgress(p);
    expect(isFinished(date)).toMatchObject({ finished: true });

    const q = initProgress(plan());
    stopProgress(q, q.steps[0]!, "rate_limited", "Rate limit exceeded");
    saveProgress(q);
    expect(isFinished(date)).toMatchObject({ finished: true });
    expect(JSON.parse(readFileSync(join(dir, date, "mirachen_ml.json"), "utf8"))).toMatchObject({ status: "rate_limited" });

    writeFileSync(join(dir, date, "plan.json"), JSON.stringify({ ...plan(), skip: { reason: "冷却中" } }));
    expect(isFinished(date)).toMatchObject({ finished: true, reason: "今天不采集：冷却中" });
  });

  it("时间线采完后加入排好的详情页；detail-needed 要求停止时不加", () => {
    const p = initProgress(plan());
    writeFileSync(
      join(dir, date, "detail-needed.json"),
      JSON.stringify({ stop: null, scheduled: [{ id: "9", handle: "theopark", url: "https://x.com/theopark/status/9", waitBeforeSec: 8, longBreakBeforeSec: 0 }] }),
    );
    expect(addDetailSteps(p)).toBe(1);
    expect(counts(p)).toMatchObject({ details: 1 });
    expect(verifyStep(date, p.steps.at(-1)!, {}).ok).toBe(false);
    writeFileSync(join(dir, date, "raw", "theopark-detail-9.json"), "{}");
    expect(verifyStep(date, p.steps.at(-1)!, {}).ok).toBe(true);

    writeFileSync(join(dir, date, "detail-needed.json"), JSON.stringify({ stop: "采集出现异常", scheduled: [{ id: "10" }] }));
    expect(addDetailSteps(initProgress(plan()))).toBe(0);
  });
});

describe("详情页拿不到响应时从页面读取全文", () => {
  const writeAccount = () => {
    mkdirSync(join(dir, date, "raw"), { recursive: true });
    writeFileSync(
      join(dir, date, "pluvio9yte.json"),
      JSON.stringify({
        source: "tencent-browser-skill",
        collectedAt: "2026-10-19T22:31:00Z",
        handle: "pluvio9yte",
        status: "ok",
        tweets: [
          { id: "9", url: "https://x.com/pluvio9yte/status/9", author: { handle: "pluvio9yte", name: "雪踏乌云" }, createdAt: "2026-10-18T00:30:00Z", text: "AI 时代到底应该怎么变现？…", textTruncated: true, metrics: { likes: 106, reposts: 12, replies: 0 } },
          { id: "8", url: "https://x.com/pluvio9yte/status/8", author: { handle: "pluvio9yte", name: "雪踏乌云" }, createdAt: "2026-10-18T00:20:00Z", text: "另一条", metrics: { likes: 1, reposts: 0, replies: 0 } },
        ],
      }),
    );
  };

  it("全文比截断版长时合并进账号文件，其他推文不变", () => {
    writeAccount();
    writeFileSync(join(dir, date, "raw", "pluvio9yte-detail-9.txt"), "AI 时代到底应该怎么变现？\n\n能真正换来真金白银的，本质上只有四样东西：注意力、认知、交付、资产。");
    const r = mergeDetailText(date, "pluvio9yte", "9", "body_limit");
    expect(r.ok).toBe(true);
    const file = JSON.parse(readFileSync(join(dir, date, "pluvio9yte.json"), "utf8"));
    expect(file.tweets[0]).toMatchObject({ textTruncated: false });
    expect(file.tweets[0].text).toContain("注意力、认知、交付、资产");
    expect(file.tweets[1].text).toBe("另一条");
  });

  it("没有全文文件、或全文不比截断版长时不算完成", () => {
    writeAccount();
    expect(mergeDetailText(date, "pluvio9yte", "9", "body_limit").ok).toBe(false);
    writeFileSync(join(dir, date, "raw", "pluvio9yte-detail-9.txt"), "AI 时代到底应该怎么变现？");
    const r = mergeDetailText(date, "pluvio9yte", "9", "body_limit");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("显示更多");
  });
});
