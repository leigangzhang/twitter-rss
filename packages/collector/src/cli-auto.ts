import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, loadConfig, loadDotEnv, localDate, runRange, TRUNCATION_THRESHOLD, xWeightedLength } from "@xrss/core";
import type { Page } from "playwright-core";
import { connectChrome, ensureChrome } from "./browser/chrome.ts";
import { budgetWait, captureAccount, captureDetail, formatClock, type RateLimit, rateLimits, type StepOutcome } from "./browser/x-page.ts";
import { parseXGraphQL } from "./parsers/x-graphql.ts";
import { inboxDir } from "./paths.ts";
import type { CrawlPlan } from "./plan.ts";
import { createRandom } from "./random.ts";
import {
  advancePhase,
  completeStep,
  counts,
  currentStep,
  detectMissingAccount,
  initProgress,
  loadPlan,
  loadProgress,
  type Progress,
  pauseStep,
  retryLater,
  saveProgress,
  skipMissingAccount,
  type Step,
  stopProgress,
  verifyStep,
} from "./runner.ts";

loadDotEnv();

/**
 * 不依赖 AI Agent 的采集：脚本连接采集专用的 Chrome（独立资料，只登录小号），按 pnpm plan 生成的清单逐步采集。
 * 采哪些账号、等多久、什么时候停，和 pnpm crawl next / done 完全一样（同一份清单、同一套进度和规则），
 * 只是"操作浏览器"这一步由脚本完成，并且能保存完整的网络响应（长推文全文在时间线响应里）。
 *
 *   pnpm crawl:chrome              打开采集专用的 Chrome（第一次用它登录 X 小号）
 *   pnpm crawl:auto                按今天的清单采集，直到完成、停止或断网暂停
 *   pnpm crawl:auto --trial 5      试采：随机挑 5 个账号采一遍，结果放在 data/trial/，不影响正式进度和冷却状态
 *   pnpm crawl:auto --trial 3 --accounts sama,karpathy,dotey
 *
 * 按 X 响应头里的额度（x-rate-limit-*）控制节奏：下一步需要的额度不够时，先等到重置；要等超过 20 分钟就暂停（退出码 6），
 * 不等到 429 才停。每一步的接口调用和额度记在 <收件箱>/calls.jsonl，额度存在 ratelimit.json，重新运行时接着用。
 *
 * 退出码：0 完成；2 因限流、验证码、登录失效等停止；3 今天不采集；5 本机网络不通（暂停，恢复后重新运行会接着采）；
 * 6 额度用完暂停（不算异常、不冷却，已采到的内容照常处理）；1 其他错误
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { trial: { type: "string" }, accounts: { type: "string" } },
});
const config = loadConfig();
const tz = config.digest.timezone;
const rng = createRandom();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
const log = (msg: string) => console.log(`[${stamp()}] ${msg}`);

if (positionals[0] === "chrome") {
  const { started } = await ensureChrome(undefined, "https://x.com/login");
  console.log(
    started
      ? "已打开采集专用的 Chrome。请在里面登录 X 小号（只登录小号，不要登录大号），登录后不要退出这个 Chrome 窗口也可以，下次采集会直接用。"
      : "采集专用的 Chrome 已经在运行，切换到它的窗口即可。",
  );
  process.exit(0);
}

const trial = values.trial !== undefined;
const date = localDate(new Date(), tz);

/** 试采：用随机挑的几个账号生成一份临时清单，放在 data/trial/<时间>/ 下 */
function trialPlan(): CrawlPlan {
  const n = Math.max(1, Number(values.trial) || 5);
  const pick = values.accounts
    ? values.accounts.split(/[,，\s]+/).filter(Boolean).map((h) => h.replace(/^@/, "").toLowerCase())
    : rng.shuffle(config.accounts).slice(0, n);
  const range = runRange(config, date);
  const crawl = config.crawl;
  return {
    date,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    contentDate: range.contentDate,
    skip: null,
    startDelaySec: 0,
    budget: { maxPageLoads: pick.length, maxDetail: 0 },
    rules: { stopOnBlock: true },
    accounts: pick.map((handle, i) => ({
      handle,
      // XRSS_X_ORIGIN 只用于本地模拟测试
      url: `${process.env.XRSS_X_ORIGIN || "https://x.com"}/${handle}`,
      topics: config.accountTopics.get(handle) ?? [],
      tier: "unrated" as const,
      since: range.since.toISOString(),
      lastSeenId: null,
      waitBeforeSec: i === 0 ? 0 : rng.int(crawl.pacing.account_delay_sec),
      longBreakBeforeSec: 0,
      scrollPausesMs: Array.from({ length: crawl.budget.max_scrolls_per_account }, () => rng.int(crawl.pacing.scroll_pause_ms)),
    })),
    deferred: [],
    output: { dir: inboxDir(date), file: "<handle>.json", schema: "" },
  };
}

function runParse(): void {
  const r = spawnSync(process.execPath, [...process.execArgv, join(import.meta.dirname, "cli-parse.ts")], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`parse 失败（退出码 ${r.status}）`);
}

let plan: CrawlPlan | undefined;
if (trial) {
  const dir = join(findRepoRoot(), "data", "trial", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  process.env.INBOX_DIR = dir;
  plan = trialPlan();
  plan.output.dir = inboxDir(date);
  mkdirSync(join(inboxDir(date), "raw"), { recursive: true });
  writeFileSync(join(inboxDir(date), "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  log(`试采 ${plan.accounts.length} 个账号：${plan.accounts.map((a) => `@${a.handle}`).join(" ")}，结果放在 ${inboxDir(date)}（不影响正式进度和冷却状态）`);
} else {
  plan = loadPlan(date);
  if (!plan) {
    console.log(`今天（${date}）还没有采集清单，先运行 pnpm plan`);
    process.exit(1);
  }
  if (plan.skip) {
    console.log(`今天不采集：${plan.skip.reason}`);
    process.exit(3);
  }
}

const progress: Progress = (!trial && loadProgress(date)) || initProgress(plan);
saveProgress(progress);
if (progress.stopped) {
  console.log(`今天的采集已因异常停止（@${progress.stopped.handle} ${progress.stopped.status}），不再打开页面`);
  process.exit(2);
}
const rawDir = join(inboxDir(date), "raw");
mkdirSync(rawDir, { recursive: true });

/** 额度要等这么久以上才恢复时，不干等，暂停采集 */
const MAX_BUDGET_WAIT_MS = 20 * 60_000;
/** 额度重置后再多等一会儿（秒），不在重置那一刻准点请求 */
const AFTER_RESET_SEC: [number, number] = [20, 60];
const rateLimitFile = join(inboxDir(date), "ratelimit.json");
const callsFile = join(inboxDir(date), "calls.jsonl");

// 同一个额度窗口里重新运行时，接着用上次记下的额度
if (existsSync(rateLimitFile)) {
  for (const rl of JSON.parse(readFileSync(rateLimitFile, "utf8")) as RateLimit[]) {
    if (rl.resetAt > Date.now()) rateLimits.set(rl.op, rl);
  }
}

function recordCalls(step: Step, outcome: StepOutcome): void {
  writeFileSync(rateLimitFile, `${JSON.stringify([...rateLimits.values()], null, 2)}\n`);
  const calls = "calls" in outcome ? (outcome.calls ?? []) : [];
  appendFileSync(callsFile, `${JSON.stringify({ at: new Date().toISOString(), handle: step.handle, kind: step.kind, outcome: outcome.kind, calls })}\n`);
}

/** 这一步大概要用多少次请求：主页第一屏 + 每次滚动，再留一点余量 */
function need(step: Step): Record<string, number> {
  if (step.kind !== "account") return { TweetDetail: 2 };
  const timeline = (step.scrollPausesMs?.length ?? 0) + 2;
  return { UserTweets: timeline, UserOriginalsTimeline: timeline, UserByScreenName: 2 };
}

/** ✓ 行后面附上时间线接口还剩多少额度 */
function quota(outcome: StepOutcome): string {
  const calls = "calls" in outcome ? (outcome.calls ?? []) : [];
  const last = calls.filter((c) => (c.op === "UserTweets" || c.op === "UserOriginalsTimeline" || c.op === "TweetDetail") && c.limit !== undefined).at(-1);
  return last ? `（${last.op} 额度 ${last.remaining}/${last.limit}）` : "";
}

await ensureChrome();
const browser = await connectChrome();
const context = browser.contexts()[0] ?? (await browser.newContext());
// 同一时间只用一个标签页
const page: Page = await context.newPage();

/** 按结果更新进度，和 pnpm crawl done 的处理一致。返回退出码，继续采集时返回 null */
function apply(step: Step, outcome: StepOutcome): number | null {
  if (outcome.kind === "offline") {
    pauseStep(progress, step);
    saveProgress(progress);
    log(`本机网络不通（${outcome.error}），暂停在 @${step.handle}。恢复网络后重新运行会从这一步继续`);
    return 5;
  }
  if (outcome.kind === "not_found") {
    skipMissingAccount(progress, step, outcome.reason);
    log(`@${step.handle}：${outcome.reason}，已跳过（不停止、不冷却）`);
    return null;
  }
  if (outcome.kind === "ok") {
    const check = verifyStep(date, step, {});
    if (check.ok) {
      completeStep(progress, step, check.message);
      if (outcome.note) log(`@${step.handle}：${outcome.note}`);
      log(`✓ @${step.handle}：${check.message}${quota(outcome)}`);
      return null;
    }
    // 存下来的响应解析不出来，按页面没加载出来处理
    outcome = { kind: "blocked", status: "error", error: check.message };
  }
  const { status, error } = outcome;
  const missing = status === "error" ? detectMissingAccount(date, step) : undefined;
  if (missing) {
    skipMissingAccount(progress, step, missing);
    log(`@${step.handle}：${missing}，已跳过`);
    return null;
  }
  if (status === "error" && retryLater(progress, step, error)) {
    log(`@${step.handle} 这次没采到（${error}），放到最后几分钟后再试一次`);
    return null;
  }
  stopProgress(progress, step, status, error);
  saveProgress(progress);
  if (!trial) runParse();
  log(`✗ @${step.handle}：${status}（${error}）。已停止采集${trial ? "" : "并进入冷却期"}`);
  return 2;
}

let exitCode = 0;
try {
  for (;;) {
    if (!trial) {
      const advanced = advancePhase(progress, runParse);
      if (advanced) log(advanced);
    } else if (!currentStep(progress)) {
      progress.phase = "finished";
    }
    saveProgress(progress);
    if (progress.phase === "finished") break;

    const step = currentStep(progress)!;
    const waitMs = new Date(progress.nextAt).getTime() - Date.now();
    if (waitMs > 0) {
      if (waitMs > 30_000) log(`等待 ${Math.round(waitMs / 1000)} 秒后打开 @${step.handle}`);
      await sleep(waitMs);
    }
    const short = budgetWait(rateLimits, need(step), Date.now());
    if (short) {
      const left = `${short.op} 额度剩 ${short.rl.remaining}/${short.rl.limit}`;
      if (short.ms > MAX_BUDGET_WAIT_MS) {
        pauseStep(progress, step);
        saveProgress(progress);
        log(`${left}，额度要到 ${formatClock(short.rl.resetAt, tz)} 才恢复，暂停采集，已采到的内容照常处理`);
        exitCode = 6;
        break;
      }
      log(`${left}，等 ${Math.ceil(short.ms / 60_000)} 分钟到 ${formatClock(short.rl.resetAt, tz)} 重置后继续`);
      await sleep(short.ms + rng.int(AFTER_RESET_SEC) * 1000);
    }
    step.status = "in_progress";
    saveProgress(progress);
    const c = counts(progress);
    log(
      step.kind === "account"
        ? `打开第 ${c.accountsDone + 1}/${c.accounts} 个账号 @${step.handle}${step.attempts ? "（重试）" : ""}`
        : `打开详情页 ${c.detailsDone + 1}/${c.details}：@${step.handle}`,
    );
    const outcome = step.kind === "account" ? await captureAccount(page, step, rawDir, rng) : await captureDetail(page, step, rawDir);
    recordCalls(step, outcome);
    const code = apply(step, outcome);
    saveProgress(progress);
    if (code !== null) {
      exitCode = code;
      break;
    }
  }
} finally {
  await page.close().catch(() => {});
}

const c = counts(progress);
if (exitCode === 0) log(`采集完成：账号 ${c.accountsDone}/${c.accounts}${c.details ? `，详情页 ${c.detailsDone}/${c.details}` : ""}`);
if (trial) console.log(`\n${trialReport()}`);
process.exit(exitCode);

/** 试采报告：每个账号拿到多少条推文、长推文是不是全文 */
function trialReport(): string {
  const lines = ["# 试采报告", "", `时间范围：${plan!.contentDate}（北京时间）`, "", "| 账号 | 结果 | 推文 | 其中前一天 | 长推文全文 | 长推文仍截断 |", "| --- | --- | --- | --- | --- | --- |"];
  let full = 0;
  let cut = 0;
  for (const step of progress.steps.filter((s) => s.kind === "account")) {
    const responses: unknown[] = [];
    for (let i = 1; existsSync(join(rawDir, `${step.handle}-${i}.json`)); i++) {
      responses.push(JSON.parse(readFileSync(join(rawDir, `${step.handle}-${i}.json`), "utf8")));
    }
    const { tweets } = parseXGraphQL(responses, step.handle);
    const inRange = tweets.filter((t) => t.createdAt >= plan!.since && t.createdAt < plan!.until);
    const longFull = tweets.filter((t) => !t.textTruncated && xWeightedLength(t.text) > TRUNCATION_THRESHOLD).length;
    const longCut = tweets.filter((t) => t.textTruncated).length;
    full += longFull;
    cut += longCut;
    lines.push(`| @${step.handle} | ${step.result ?? step.status} | ${tweets.length} | ${inRange.length} | ${longFull} | ${longCut} |`);
  }
  const verdict =
    full + cut === 0
      ? "这几个账号最近没有长推文，判断不了，可以换几个常发长文的账号再试（--accounts）。"
      : cut === 0
        ? "时间线响应自带全文，正式采集基本不用再开详情页。"
        : "仍有截断的长推文，正式采集会照常补抓详情页。";
  lines.push("", `长推文：全文 ${full} 条，仍截断 ${cut} 条。${verdict}`);
  const text = lines.join("\n");
  writeFileSync(join(inboxDir(date), "report.md"), `${text}\n`);
  return `${text}\n\n报告已写入 ${join(inboxDir(date), "report.md")}`;
}

