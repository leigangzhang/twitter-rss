import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, listSubscribers, migrateDb, STATUS_LABELS, subscribersCsv } from "@xrss/core/db";

loadDotEnv();

/**
 * 订阅者一览：
 *   pnpm subscribers          在终端列出所有订阅者
 *   pnpm subscribers --csv    同时导出 data/out/subscribers.csv（可用 Excel / Numbers 打开）
 */
const { values } = parseArgs({ options: { csv: { type: "boolean", default: false } } });
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const list = await listSubscribers(db, config);
const tz = config.digest.timezone;
const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—";

const count = (s: string) => list.filter((x) => x.status === s).length;
console.log(`共 ${list.length} 位：正常 ${count("active")}，待确认 ${count("pending")}，已退订 ${count("unsubscribed")}\n`);
for (const s of list) {
  console.log(`#${s.id} ${s.email}  [${STATUS_LABELS[s.status]}] ${s.lang === "zh" ? "中文" : "原文"}`);
  console.log(`   订阅 ${fmt(s.createdAt)} · 确认 ${fmt(s.confirmedAt)} · 最近发送 ${s.lastSentDate ?? "—"} · 累计 ${s.sentCount} 封`);
  console.log(`   主题：${s.topics.map((t) => t.name).join("、") || "（无）"}${s.invalidTopics.length ? `  失效：${s.invalidTopics.join("、")}` : ""}`);
  if (s.issues.length) console.log(`   ⚠ ${s.issues.join("；")}`);
}

if (values.csv) {
  const dir = join(findRepoRoot(), "data", "out");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "subscribers.csv");
  writeFileSync(path, subscribersCsv(list, tz));
  console.log(`\n已导出 ${path}`);
}
