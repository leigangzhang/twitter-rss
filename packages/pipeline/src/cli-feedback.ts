import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, listFeedback, migrateDb, REASON_LABELS } from "@xrss/core/db";

loadDotEnv();

/**
 * 读者对邮件里推文的 👍 / 👎 反馈（新的在前）：
 *   pnpm feedback               最近 50 条
 *   pnpm feedback --down        只看 👎
 *   pnpm feedback --limit 200
 */
const { values } = parseArgs({ options: { limit: { type: "string", default: "50" }, down: { type: "boolean", default: false } } });
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const list = await listFeedback(db, { limit: Math.max(1, Number(values.limit) || 50), vote: values.down ? "down" : undefined });
if (list.length === 0) {
  console.log("还没有反馈");
  process.exit(0);
}
const fmt = (d: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: config.digest.timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const up = list.filter((f) => f.vote === "up").length;
console.log(`${list.length} 条：👍 ${up}，👎 ${list.length - up}\n`);
for (const f of list) {
  const text = f.text.replace(/\s+/g, " ").slice(0, 40);
  const reason = f.reason ? `（${REASON_LABELS[f.reason]}）` : "";
  console.log(`${fmt(f.updatedAt)}  ${f.issueDate}  ${f.vote === "up" ? "👍" : "👎"}${reason}  @${f.handle ?? "?"}  ${text}  ${f.email ?? "匿名"}`);
}
