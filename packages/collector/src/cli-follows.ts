import { parseArgs } from "node:util";
import type { Page } from "playwright-core";
import { addAccountsToTopic, addTopic, editConfigFile, loadConfig, loadDotEnv, localDate } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { connectChrome, ensureChrome } from "./browser/chrome.ts";
import { captureFollowing, loggedInHandle } from "./browser/x-page.ts";
import { acquireBrowserLock, type FollowSyncState, loadSyncState, parseFollowing, planSync, SYNC_STEP_LABELS, type SyncStep, saveSyncState, syncDue } from "./follows.ts";
import { checkGate, loadState, recordBlock, saveState } from "./health.ts";
import { budgetWarning, loadAccountQuality } from "./quality.ts";
import { createRandom } from "./random.ts";

loadDotEnv();

/**
 * 把一个 X 账号的关注列表同步进 config/topics.yaml（设置见 crawl.yaml 的 follow_sync）。
 *
 *   pnpm follows:sync             同步一次
 *   pnpm follows:sync --dry-run   只读关注列表，列出会新增哪些账号，不改文件
 *   pnpm follows:sync --if-due    每日任务用：没打开 follow_sync.enabled 或还没到间隔时直接退出
 *
 * 用采集专用的 Chrome 打开"正在关注"页往下滚动读取，不点任何按钮；冷却期、不在采集时段时不运行；
 * 遇到限流、验证码、登录失效就停止，并和采集一样进入冷却。
 *
 * 每一步的进度和最后的结果（成功或失败、失败在哪一步）都写进 data/follow-sync.json，后台弹窗据此显示；
 * 任何没预料到的错误也会记成一次失败，不会只留在日志里。
 *
 * 退出码：0 完成或不需要同步；2 遇到限制已停止并冷却；3 冷却中或不在采集时段；4 采集的 Chrome 正被占用；5 本机网络不通；1 其他错误
 */
const { values } = parseArgs({ options: { "dry-run": { type: "boolean" }, "if-due": { type: "boolean" } } });
const config = loadConfig();
const fs = config.crawl.follow_sync;
const tz = config.digest.timezone;
const rng = createRandom();
const dry = Boolean(values["dry-run"]);
const state = loadSyncState();
const log = (msg: string) => console.log(`[follows] ${msg}`);

const startedAt = new Date().toISOString();
let step: SyncStep = "gate";

/** 记下进行到哪一步（后台弹窗显示进度） */
function progress(next: SyncStep, read?: number): void {
  step = next;
  if (read === undefined) log(SYNC_STEP_LABELS[next]);
  saveSyncState({ ...state, progress: { pid: process.pid, startedAt, dryRun: dry, step, read } });
}

/** 记下这次的结果（后台显示）。试运行只记结果，不改同步状态 */
function finish(code: number, ok: boolean, message: string, added: string[] = [], next?: Partial<FollowSyncState>): never {
  log(message);
  const last = { at: new Date().toISOString(), ok, message, added, dryRun: dry || undefined, step: ok ? undefined : step };
  // 另一个同步正在运行（拿不到 Chrome）时，保留它的进度
  const other = loadSyncState().progress;
  saveSyncState({ ...state, ...(dry ? {} : next), progress: other && other.pid !== process.pid ? other : undefined, last });
  process.exit(code);
}

if (values["if-due"] && (!fs.enabled || !syncDue(state, config))) {
  log(fs.enabled ? `上次同步在 ${state.lastSyncAt}，还没到 ${fs.every_days} 天的间隔` : "没有打开 follow_sync.enabled，跳过");
  process.exit(0);
}

// 没预料到的错误也记成一次失败，不只留在日志里
const crash = (e: unknown) => finish(1, false, `${SYNC_STEP_LABELS[step]}时失败：${(e as Error)?.message ?? String(e)}`);
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

const crawlState = loadState();
const gate = checkGate(crawlState, config.crawl, tz);
if (!gate.ok) finish(3, false, `现在不能访问 X：${gate.reason}${gate.until ? `（到 ${gate.until}）` : ""}`);

const busy = acquireBrowserLock("同步关注");
if (busy) finish(4, false, `${busy}，稍后再同步`);

const origin = process.env.XRSS_X_ORIGIN || "https://x.com";

interface Result {
  code: number;
  ok: boolean;
  message: string;
  added?: string[];
  next?: Partial<FollowSyncState>;
}

async function sync(page: Page): Promise<Result> {
  progress("account");
  const handle = fs.handle ?? (await loggedInHandle(page, origin));
  if (!handle) return { code: 1, ok: false, message: "认不出采集 Chrome 里登录的是哪个账号（可能没登录）。请先登录，或在 crawl.yaml 的 follow_sync.handle 写上账号" };
  progress("read", 0);
  log(`读取 @${handle} 的关注列表（最多 ${fs.max_accounts} 个）`);

  // X 每屏约 20 个，按上限留够滚动次数
  const scrolls = Math.ceil(fs.max_accounts / 20) + 10;
  const outcome = await captureFollowing(
    page,
    `${origin}/${handle}/following`,
    { scrollPausesMs: Array.from({ length: scrolls }, () => rng.int(config.crawl.pacing.scroll_pause_ms)), maxAccounts: fs.max_accounts,
      count: (r) => {
        const n = parseFollowing(r).length;
        progress("read", n);
        return n;
      },
    },
    rng,
  );
  if (outcome.kind === "offline") return { code: 5, ok: false, message: `本机网络不通（${outcome.error}），没有同步` };
  if (outcome.kind === "not_found") return { code: 1, ok: false, message: `@${handle}：${outcome.reason}` };
  if (outcome.kind === "blocked") {
    if (!dry) saveState(recordBlock(crawlState, { date: localDate(new Date(), tz), handle, status: outcome.status, error: outcome.error }, config.crawl));
    return { code: 2, ok: false, message: `读取关注列表时遇到 ${outcome.status}（${outcome.error}），已停止${dry ? "" : "并和采集一样进入冷却"}` };
  }

  const users = parseFollowing(outcome.responses).slice(0, fs.max_accounts);
  if (outcome.note) log(outcome.note);
  const plan = planSync(state, users, config.accounts, handle, outcome.complete);
  const summary = [
    `读到 ${users.length} 个关注${outcome.complete ? "（完整）" : "（没读完）"}`,
    plan.add.length ? `新增 ${plan.add.length} 个：${plan.add.map((h) => `@${h}`).join(" ")}` : "没有新账号",
    ...(plan.newlyIgnored.length ? [`之前同步、已被手动移出，不再同步：${plan.newlyIgnored.map((h) => `@${h}`).join(" ")}`] : []),
    ...(plan.unfollowed.length ? [`已取关但还在名单里（可在后台移出）：${plan.unfollowed.map((h) => `@${h}`).join(" ")}`] : []),
  ];
  if (dry) return { code: 0, ok: true, message: `试运行，不改 topics.yaml。${summary.join("；")}`, added: plan.add };

  progress("write");
  if (plan.add.length) {
    const t = fs.topic;
    const exists = config.topics.some((x) => x.id === t.id);
    editConfigFile(config.configDir, "topics.yaml", (text) => (exists ? addAccountsToTopic(text, t.id, plan.add) : addTopic(text, t, plan.add)));
    summary.push(`已写进主题「${t.name}」${exists ? "" : "（新建）"}`);
  }
  const fresh = loadConfig();
  const db = createDb();
  await migrateDb(db);
  const warning = budgetWarning([...(await loadAccountQuality(db, fresh)).values()].map((a) => a.tier), fresh);
  if (warning) summary.push(`⚠ ${warning}`);
  return { code: 0, ok: true, message: summary.join("；"), added: plan.add, next: { ...plan.next, handle, lastSyncAt: new Date().toISOString() } };
}

let result: Result;
let page: Page | undefined;
try {
  progress("chrome");
  await ensureChrome();
  const browser = await connectChrome();
  const context = browser.contexts()[0] ?? (await browser.newContext());
  // 同一时间只用一个标签页，用完关掉
  page = await context.newPage();
  result = await sync(page);
} catch (e) {
  result = { code: 1, ok: false, message: `${SYNC_STEP_LABELS[step]}时失败：${(e as Error).message}` };
} finally {
  await page?.close().catch(() => {});
}
finish(result.code, result.ok, result.message, result.added, result.next);
