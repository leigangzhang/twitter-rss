import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, loadConfig, loadDotEnv, localDate } from "@xrss/core";
import { createDb, listFeedback, migrateDb } from "@xrss/core/db";
import { createLlmCurationTuner, describeLlm } from "./ai.ts";
import { applyCurationEdits, changelogEntry, feedbackPayload, prependChangelog } from "./curation-tune.ts";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";

loadDotEnv();

/**
 * 根据后台的赞 / 踩自动修改精选标准（config/curation.md），由 scripts/daily.sh 在每天评审前调用（脚本版和 Agent 版每日任务都经过它）：
 *   pnpm feedback:tune             上次运行以来的反馈（第一次运行取最近 24 小时）；同一天已经运行过就跳过
 *   pnpm feedback:tune --dry-run   只打印建议的改动，不修改文件
 *   pnpm feedback:tune --days 7    改用最近 7 天的反馈（会再次运行，即使今天已经运行过）
 *   pnpm feedback:tune --force     今天已经运行过也再运行一次
 *   pnpm feedback:tune --notify    有改动时给管理员（.env 的 ADMIN_EMAIL）发一封提醒
 *   pnpm feedback:tune --revert    撤销最近一次自动修改
 *
 * 每次修改前把原文件备份到 data/curation-history/，改动和理由写进 config/curation-changelog.md。
 * 退出码：0 正常（包括没有反馈、没有改动）；1 出错（模型调用失败等，不影响当天的每日任务）
 */
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    notify: { type: "boolean", default: false },
    revert: { type: "boolean", default: false },
    days: { type: "string" },
  },
});

const config = loadConfig();
const tz = config.digest.timezone;
const root = findRepoRoot();
const guidePath = join(config.configDir, "curation.md");
const changelogPath = join(config.configDir, "curation-changelog.md");
const historyDir = join(root, "data", "curation-history");
const statePath = join(root, "data", "curation-tune.json");
const rel = (p: string) => relative(root, p);

const now = new Date();
const parts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(now)
    .map((p) => [p.type, p.value]),
);
const stamp = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
const fileStamp = stamp.replace(" ", "-").replace(":", "");
const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const fmt = (d: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

if (values.revert) {
  const backups = existsSync(historyDir) ? readdirSync(historyDir).filter((f) => f.endsWith(".md")).sort() : [];
  const latest = backups.at(-1);
  if (!latest) {
    console.log("没有可以撤销的自动修改");
    process.exit(0);
  }
  const backup = join(historyDir, latest);
  writeFileSync(guidePath, readFileSync(backup, "utf8"));
  // 撤销过的备份改名，下次 --revert 撤销再前一次
  renameSync(backup, `${backup}.reverted`);
  writeFileSync(changelogPath, prependChangelog(readText(changelogPath), `## ${stamp} 撤销\n\n已把 config/curation.md 恢复为 \`${rel(backup)}\`（${latest.replace(/\.md$/, "")} 那次修改之前的版本）。\n`));
  console.log(`已撤销：config/curation.md 恢复为 ${rel(backup)}`);
  process.exit(0);
}

const state = (() => {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as { lastRunAt?: string };
  } catch {
    return {};
  }
})();
const lastRunAt = state.lastRunAt ? new Date(state.lastRunAt) : null;
if (!values.force && !values.days && lastRunAt && localDate(lastRunAt, tz) === localDate(now, tz)) {
  console.log(`今天（${fmt(lastRunAt)}）已经根据反馈调整过精选标准，跳过。要再运行一次加 --force`);
  process.exit(0);
}
const days = Number(values.days);
const since = values.days && days > 0 ? new Date(now.getTime() - days * 86_400_000) : (lastRunAt ?? new Date(now.getTime() - 86_400_000));
const saveState = () => {
  if (values["dry-run"]) return;
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ lastRunAt: now.toISOString() }, null, 2) + "\n");
};

const db = createDb();
await migrateDb(db);
const list = (await listFeedback(db, { limit: 5000 })).filter((f) => f.updatedAt > since);
const down = list.filter((f) => f.vote === "down").length;
const up = list.length - down;
console.log(`根据反馈调整精选标准：${fmt(since)} 以来 ${list.length} 条反馈（赞 ${up}，踩 ${down}）${values["dry-run"] ? "，试跑，不修改文件" : ""}`);
if (down === 0) {
  console.log("没有新的踩，不修改精选标准");
  saveState();
  process.exit(0);
}

const guide = readText(guidePath);
if (!guide?.trim()) {
  console.error(`找不到 ${rel(guidePath)}，无法调整`);
  process.exit(1);
}
const topicName = new Map(config.topics.map((t) => [t.id, t.name]));
let result;
try {
  console.log(`  模型：${describeLlm()}`);
  result = await createLlmCurationTuner().propose(guide, feedbackPayload(list, (id) => topicName.get(id) ?? id));
} catch (e) {
  // 不记录运行时间：下次运行时这些反馈还会被处理
  console.error(`  调整失败：${(e as Error).message}`);
  process.exit(1);
}

const apply = applyCurationEdits(guide, result.edits);
console.log(`  ${result.summary.trim()}`);
apply.applied.forEach((e, i) => console.log(`  改动 ${i + 1}：${e.why.trim()}\n    - ${e.old.trim().replace(/\n/g, "\n      ")}\n    + ${e.new.trim().replace(/\n/g, "\n      ")}`));
for (const { problem, edit } of apply.rejected) console.log(`  未采纳（${problem}）：${edit.why.trim()}`);
for (const n of result.notes) console.log(`  建议：${n.trim()}`);

if (values["dry-run"]) process.exit(0);

let backup: string | null = null;
if (apply.applied.length) {
  mkdirSync(historyDir, { recursive: true });
  backup = join(historyDir, `${fileStamp}.md`);
  writeFileSync(backup, guide);
  writeFileSync(guidePath, apply.text);
}
if (apply.applied.length || apply.rejected.length || result.notes.length) {
  const entry = changelogEntry({ stamp, since: fmt(since), up, down, result, apply, backup: backup && rel(backup) });
  writeFileSync(changelogPath, prependChangelog(readText(changelogPath), entry));
  console.log(`  ${apply.applied.length ? `已修改 ${rel(guidePath)}，原文件备份在 ${rel(backup!)}；` : "精选标准没有改动；"}记录见 ${rel(changelogPath)}`);
}
saveState();

const admin = process.env.ADMIN_EMAIL?.trim();
const smtp = smtpConfigFromEnv();
if (values.notify && apply.applied.length && admin && smtp) {
  const mailer = createSmtpMailer(smtp, { intervalMs: 0 });
  const text = `${changelogEntry({ stamp, since: fmt(since), up, down, result, apply, backup: backup && rel(backup) })}\n不认可这次改动：在项目目录运行 pnpm feedback:tune --revert。`;
  const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  try {
    await mailer.send({ to: admin, subject: `【精选晨报】根据反馈修改了精选标准（${apply.applied.length} 处）`, text, html: `<pre style="font:14px/1.6 sans-serif;white-space:pre-wrap">${escaped}</pre>` });
    console.log(`  已发提醒到 ${admin}`);
  } catch (e) {
    console.warn(`  提醒发送失败：${(e as Error).message}`);
  } finally {
    mailer.close();
  }
}
process.exit(0);
