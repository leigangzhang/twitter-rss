import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv, localDate } from "@xrss/core";
import { checkGate, loadState, resetState, saveState, statePath } from "./health.ts";
import {
  addDetailSteps,
  type BlockStatus,
  completeStep,
  counts,
  currentStep,
  initProgress,
  isFinished,
  loadPlan,
  loadProgress,
  type Progress,
  saveProgress,
  type Step,
  stopProgress,
  verifyStep,
} from "./runner.ts";

loadDotEnv();

/**
 *   pnpm crawl next       逐步采集：给出下一步（会先等够清单里的时间），照做后运行 pnpm crawl done
 *   pnpm crawl done <key> 报告这一步做完了（会检查网络响应是否保存）；异常时加 --status rate_limited 等
 *   pnpm crawl progress   查看今天的采集进度；没采完时退出码为 4
 *   pnpm crawl:status     查看采集健康状态：冷却期、暂停原因、最近异常和用量
 *   pnpm crawl:reset      人工确认 X 账号正常（如已重新登录）后，解除暂停和冷却
 */
const command = process.argv[2];
const config = loadConfig();
const state = loadState();
const tz = config.digest.timezone;
const date = localDate(new Date(), tz);

/** 一次最多等这么久就返回，避免单条命令运行太久被采集端的工具超时打断 */
const MAX_WAIT_SEC = 90;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bjTime = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** 调用 parse（与 pnpm --filter @xrss/collector parse 相同），沿用当前进程的 tsx 加载器 */
function runParse(): void {
  const r = spawnSync(process.execPath, [...process.execArgv, join(import.meta.dirname, "cli-parse.ts")], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`parse 失败（退出码 ${r.status}）`);
}

function progressLine(p: Progress): string {
  const c = counts(p);
  return `进度：账号 ${c.accountsDone}/${c.accounts}${c.details ? `，详情页 ${c.detailsDone}/${c.details}` : ""}`;
}

function printStep(p: Progress, step: Step): void {
  const c = counts(p);
  const raw = `data/inbox/${p.date}/raw`;
  if (step.kind === "account") {
    const index = p.steps.filter((s) => s.kind === "account").indexOf(step) + 1;
    const pauses = (step.scrollPausesMs ?? []).map((ms) => (ms / 1000).toFixed(1));
    console.log(`STEP account ${step.key}
=== 第 ${index}/${c.accounts} 个账号：@${step.handle} ===
1. 在同一个标签页打开 ${step.url}，等时间线加载完。
2. 把网络响应原样保存（完整的响应正文，不要改写）：
   - 地址含 UserOriginalsTimeline 或 UserTweets 的 → ${raw}/${step.handle}-1.json，滚动后新出现的依次存 -2.json、-3.json …
   - 地址含 UserByScreenName 的（账号资料，含头像）→ ${raw}/${step.handle}-profile.json
3. 向下滚动最多 ${pauses.length} 次，每次滚动前等待：${pauses.join("、")} 秒。
   看到早于 ${bjTime(step.since!)}（北京时间）的推文${step.lastSeenId ? `，或 ID 为 ${step.lastSeenId} 的推文` : ""}就停止滚动（置顶推文除外）。
4. 完成后运行：pnpm crawl done ${step.key}
遇到限流、验证码、登录失效等异常：不要重试，运行 pnpm crawl done ${step.key} --status rate_limited|captcha|login_required|error --error "页面上看到的提示"`);
  } else {
    const index = p.steps.filter((s) => s.kind === "detail").indexOf(step) + 1;
    console.log(`STEP detail ${step.key}
=== 第 ${index}/${c.details} 个详情页：@${step.handle} ===
1. 在同一个标签页打开 ${step.url}，不需要滚动，不要展开评论。
2. 把地址含 TweetDetail 的网络响应原样保存到 ${raw}/${step.handle}-detail-${step.key.replace(/^detail-/, "")}.json
3. 完成后运行：pnpm crawl done ${step.key}
遇到异常：pnpm crawl done ${step.key} --status rate_limited|captcha|login_required|error --error "页面上看到的提示"`);
  }
}

if (command === "next") {
  const plan = loadPlan(date);
  if (!plan) {
    console.log(`STOP 今天（${date}）还没有采集清单，先运行 pnpm plan`);
    process.exit(1);
  }
  if (plan.skip) {
    console.log(`SKIP 今天不采集：${plan.skip.reason}。不要打开浏览器，直接运行 scripts/daily.sh`);
    process.exit(3);
  }
  let progress = loadProgress(date);
  if (!progress) {
    progress = initProgress(plan);
    saveProgress(progress);
    console.log(`开始今天的采集：${plan.accounts.length} 个账号。整个过程会持续较长时间（通常 30–60 分钟），这是正常的。`);
  }
  if (progress.stopped) {
    console.log(`STOP 采集已因异常停止（@${progress.stopped.handle} ${progress.stopped.status}）。不要再打开任何页面，运行 scripts/daily.sh`);
    process.exit(2);
  }

  // 时间线采完：解析，排出详情页；详情页也采完：再解析一次，结束
  if (!currentStep(progress) && progress.phase === "timeline") {
    runParse();
    const added = addDetailSteps(progress);
    progress.phase = added > 0 ? "detail" : "finished";
    if (added === 0) runParse();
    saveProgress(progress);
    console.log(added > 0 ? `时间线已全部采完，接下来补抓 ${added} 个详情页。` : "时间线已全部采完，不需要补抓详情页。");
  } else if (!currentStep(progress) && progress.phase === "detail") {
    runParse();
    progress.phase = "finished";
    saveProgress(progress);
  }
  if (progress.phase === "finished") {
    console.log(`FINISHED 今天的采集已全部完成。${progressLine(progress)}。下一步运行 scripts/daily.sh`);
    process.exit(0);
  }

  const step = currentStep(progress)!;
  if (step.status === "in_progress") {
    console.log("（这一步之前已经给出，还没有运行 pnpm crawl done。如果已经做完，直接运行 done；没做完就继续做。）");
    printStep(progress, step);
    process.exit(0);
  }

  // 等到下一步的开始时间；一次最多等 MAX_WAIT_SEC 秒
  const waitMs = new Date(progress.nextAt).getTime() - Date.now();
  if (waitMs > 0) {
    await sleep(Math.min(waitMs, MAX_WAIT_SEC * 1000));
    const left = Math.ceil((new Date(progress.nextAt).getTime() - Date.now()) / 1000);
    if (left > 0) {
      console.log(`WAIT 还需等待 ${left} 秒才能开始下一步。请立即再次运行 pnpm crawl next（它会自己等待），不要自己 sleep，也不要跳过。${progressLine(progress)}`);
      process.exit(0);
    }
  }
  step.status = "in_progress";
  saveProgress(progress);
  printStep(progress, step);
  process.exit(0);
}

if (command === "done") {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: { status: { type: "string" }, error: { type: "string" }, "no-response": { type: "string" } },
  });
  const key = positionals[0];
  const progress = loadProgress(date);
  const step = progress?.steps.find((s) => s.key.toLowerCase() === key?.toLowerCase());
  if (!progress || !step) {
    console.log(`ERROR 今天的进度里没有 ${key ?? "（未指定）"}。先运行 pnpm crawl next 获取当前步骤。`);
    process.exit(1);
  }
  if (step.status === "done") {
    console.log(`这一步已经完成过了。下一步运行 pnpm crawl next。${progressLine(progress)}`);
    process.exit(0);
  }
  if (values.status && values.status !== "ok") {
    const allowed: BlockStatus[] = ["rate_limited", "login_required", "captcha", "error"];
    if (!allowed.includes(values.status as BlockStatus)) {
      console.log(`ERROR --status 只能是 ${allowed.join(" / ")}`);
      process.exit(1);
    }
    stopProgress(progress, step, values.status as BlockStatus, values.error);
    saveProgress(progress);
    runParse();
    console.log(`STOP 已记录异常并停止采集，进入冷却期。不要再打开任何页面，运行 scripts/daily.sh`);
    process.exit(2);
  }
  const check = verifyStep(date, step, { noResponse: values["no-response"] });
  if (!check.ok) {
    console.log(`NOT_DONE ${check.message}`);
    process.exit(1);
  }
  completeStep(progress, step, check.message);
  saveProgress(progress);
  console.log(`OK @${step.handle}：${check.message}。${progressLine(progress)}。下一步运行 pnpm crawl next`);
  process.exit(0);
}

if (command === "progress") {
  const f = isFinished(date);
  const progress = loadProgress(date);
  console.log(f.reason);
  if (progress) {
    for (const s of progress.steps.filter((x) => x.status !== "pending")) {
      console.log(`  ${s.status === "done" ? "✓" : "…"} ${s.kind === "account" ? "@" : ""}${s.key}${s.result ? `：${s.result}` : ""}`);
    }
  }
  process.exit(f.finished ? 0 : 4);
}

if (command === "reset") {
  saveState(resetState(state));
  console.log("已解除暂停和冷却，下次 pnpm plan 会正常安排采集");
  process.exit(0);
}

const gate = checkGate(state, config.crawl, config.digest.timezone);
console.log(`状态文件：${statePath()}`);
console.log(gate.ok ? "现在可以采集" : `现在不采集：${gate.reason}${gate.until ? `（到 ${gate.until}）` : ""}`);
console.log(`连续异常次数：${state.consecutiveIncidents}`);

const incidents = state.incidents.slice(-5).reverse();
if (incidents.length > 0) {
  console.log("\n最近的异常：");
  for (const i of incidents) {
    console.log(`  ${i.at}  @${i.handle}  ${i.status}${i.error ? `（${i.error}）` : ""}  冷却 ${i.cooldownHours === "manual" ? "需人工处理" : `${i.cooldownHours} 小时`}`);
  }
}

const runs = state.runs.slice(-7).reverse();
if (runs.length > 0) {
  console.log("\n最近的采集：");
  for (const r of runs) {
    console.log(`  ${r.date}  账号 ${r.accounts}  主页 ${r.timelinePages}  详情页 ${r.detailPages}${r.blocked ? `  异常 ${r.blocked}` : ""}`);
  }
}
