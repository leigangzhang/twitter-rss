import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "@xrss/core";
import { lockHolder } from "@xrss/collector/follows";
import { isAdmin } from "@/lib/admin";

/** 立即同步关注：在后台启动 pnpm follows:sync，输出写到 data/logs/follow-sync.log，结果记在 data/follow-sync.json */
export async function POST() {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const busy = lockHolder();
  if (busy) return Response.json({ message: `${busy.what}正在使用采集的 Chrome，稍后再同步` }, { status: 409 });
  const root = findRepoRoot();
  mkdirSync(join(/*turbopackIgnore: true*/ root, "data", "logs"), { recursive: true });
  const out = openSync(join(/*turbopackIgnore: true*/ root, "data", "logs", "follow-sync.log"), "a");
  try {
    const child = spawn("pnpm", ["-s", "follows:sync"], { cwd: root, detached: true, stdio: ["ignore", out, out], env: process.env });
    child.unref();
  } catch (e) {
    return Response.json({ message: `启动失败：${(e as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true, message: "已开始同步，读完关注列表一般要几分钟，稍后刷新页面查看结果" });
}
