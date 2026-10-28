import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { findRepoRoot } from "@xrss/core";
import { loadSyncState, lockHolder, runningSync, saveSyncState, syncLogPath, syncLogTail } from "@xrss/collector/follows";
import { isAdmin } from "@/lib/admin";

/** 同步状态：最近一次结果、正在进行的进度、日志最后几行（后台弹窗每几秒取一次） */
export async function GET() {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const state = loadSyncState();
  return Response.json({ last: state.last ?? null, progress: runningSync(state), log: syncLogTail(20) });
}

/**
 * 立即同步关注：在后台启动 pnpm follows:sync（body 里 dryRun: true 时加 --dry-run），输出写到 data/logs/follow-sync.log。
 * 同步脚本自己会把进度和结果写进 data/follow-sync.json；脚本没能写结果就退出（启动失败、被杀）时，这里补记一次失败。
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const busy = lockHolder();
  if (busy) return Response.json({ message: `${busy.what}正在使用采集的 Chrome，稍后再同步` }, { status: 409 });
  if (runningSync(loadSyncState())) return Response.json({ message: "已经有一个同步在运行" }, { status: 409 });

  const startedAt = Date.now();
  const logPath = syncLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const out = openSync(logPath, "a");
  const recordFailure = (message: string) => {
    const state = loadSyncState();
    if (state.last && new Date(state.last.at).getTime() >= startedAt) return;
    saveSyncState({ ...state, progress: undefined, last: { at: new Date().toISOString(), ok: false, message, added: [], dryRun: dryRun || undefined } });
  };
  try {
    const child = spawn("pnpm", ["-s", "follows:sync", ...(dryRun ? ["--dry-run"] : [])], { cwd: findRepoRoot(), detached: true, stdio: ["ignore", out, out], env: process.env });
    child.on("error", (e) => recordFailure(`同步没能启动：${e.message}`));
    child.on("exit", (code, signal) => {
      if (code !== 0) recordFailure(`同步进程意外退出（${signal ? `信号 ${signal}` : `退出码 ${code}`}），详见日志`);
    });
    child.unref();
  } catch (e) {
    recordFailure(`同步没能启动：${(e as Error).message}`);
    return Response.json({ message: `启动失败：${(e as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true, message: dryRun ? "已开始试运行" : "已开始同步" });
}
