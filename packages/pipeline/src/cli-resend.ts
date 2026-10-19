import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb, subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { issueDetail, KIND_LABELS, listIssues, resendTo, retryFailed, sendMissing } from "./delivery.ts";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";

loadDotEnv();

/**
 * 推送历史与重新推送：
 *   pnpm resend                                  列出最近的推送
 *   pnpm resend --date 2026-10-19                查看这一期的收件人、推文和发送记录
 *   pnpm resend --date 2026-10-19 --failed       重试这一期发送失败的
 *   pnpm resend --date 2026-10-19 --missing      补发给这一期本该收到却没收到的
 *   pnpm resend --date 2026-10-19 --to a@b.com   把这一期重新发给某位订阅者
 */
const { values } = parseArgs({ options: { date: { type: "string" }, failed: { type: "boolean" }, missing: { type: "boolean" }, to: { type: "string" } } });
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const tz = config.digest.timezone;
const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "—");

if (!values.date) {
  const issues = await listIssues(db, config);
  if (issues.length === 0) console.log("还没有推送记录");
  for (const i of issues) {
    console.log(`${i.date}（内容 ${i.periodLabel}）  成功 ${i.sent}  失败 ${i.failed}  未收到 ${i.missing}  推文 ${i.items} 条  发送 ${i.attempts} 次  最近 ${fmt(i.lastSentAt)}`);
  }
  process.exit(0);
}

const date = values.date;
const action = values.failed ? "failed" : values.missing ? "missing" : values.to ? "to" : null;
if (!action) {
  const d = await issueDetail(db, config, date);
  if (!d) {
    console.log(`${date} 没有推送记录`);
    process.exit(0);
  }
  console.log(`${date}（内容 ${d.periodLabel}）：成功 ${d.sent}，失败 ${d.failed}，未收到 ${d.missing}\n`);
  for (const r of d.recipients) {
    const label = { sent: "成功", failed: "失败", missing: "未收到" }[r.status];
    console.log(`  [${label}] ${r.subscriber.email}  ${fmt(r.sentAt)}  ${r.items} 条${r.error ? `  ${r.error}` : ""}`);
  }
  console.log(`\n推文（${d.list.length} 条）：`);
  for (const i of d.list) console.log(`  @${i.handle}  ${i.receivedBy} 人  ${i.summary}`);
  console.log("\n发送记录：");
  for (const l of d.log) console.log(`  ${fmt(l.sentAt)}  ${KIND_LABELS[l.kind]}  ${l.email}  ${l.status === "sent" ? "成功" : `失败：${l.error}`}`);
  process.exit(0);
}

const smtp = smtpConfigFromEnv();
if (!smtp) {
  console.error("缺少 SMTP_USER 或 SMTP_PASS（QQ 邮箱授权码），无法发送");
  process.exit(1);
}
const mailer = createSmtpMailer(smtp, { intervalMs: config.digest.mail.send_interval_ms });
try {
  if (action === "failed") {
    const results = await retryFailed(db, config, mailer, date);
    if (results.length === 0) console.log("这一期没有发送失败的订阅者");
    for (const r of results) console.log(`  ${r.email}：${r.status === "sent" ? "✓" : "✗"} ${r.message}`);
  } else if (action === "missing") {
    const s = await sendMissing(db, config, mailer, date);
    console.log(`补发：成功 ${s.sent}，失败 ${s.failed.length}，没有对应内容 ${s.skippedEmpty}`);
    for (const f of s.failed) console.log(`  ✗ ${f.email}：${f.error}`);
  } else {
    const [sub] = await db.select().from(subscribers).where(eq(subscribers.email, values.to!.trim().toLowerCase()));
    if (!sub) {
      console.error(`找不到订阅者 ${values.to}`);
      process.exitCode = 1;
    } else {
      const r = await resendTo(db, config, mailer, date, sub.id);
      console.log(`  ${r.email}：${r.status === "sent" ? "✓" : r.status === "failed" ? "✗" : "—"} ${r.message}`);
    }
  }
} finally {
  mailer.close();
}
