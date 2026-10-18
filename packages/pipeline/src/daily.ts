import { parseArgs } from "node:util";
import { loadConfig, localDate, runRange, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { createLlmReviewer, createRuleOnlyReviewer } from "./ai.ts";
import { pickCandidates } from "./candidates.ts";
import { sendDigests } from "./digest.ts";
import { ingest } from "./ingest.ts";
import { createResendMailer } from "./mailer.ts";
import { reviewCandidates } from "./review.ts";

loadDotEnv();

/**
 * 每日流水线：入库 → 规则粗筛 → AI 评审 → 按订阅者选稿 → 发送邮件
 *
 *   pnpm pipeline                 正式运行
 *   pnpm pipeline:dry             试跑：不发邮件，把邮件写到 data/out/<日期>/
 *   pnpm pipeline --skip-ai       不调用 AI，只用规则分（不翻译）
 *   pnpm pipeline --date 2026-10-18
 */
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "skip-ai": { type: "boolean", default: false },
    date: { type: "string" },
  },
});

const config = loadConfig();
const now = new Date();
const date = values.date ?? localDate(now, config.digest.timezone);
const range = runRange(config, date, now);
const dryRun = values["dry-run"]!;

const db = createDb();
await migrateDb(db);

console.log(
  `▶ ${date}${dryRun ? "（试跑，不发送）" : ""}，处理 ${range.since.toISOString()} ~ ${range.until.toISOString()} 发布的推文${config.digest.collect_window === "previous_day" ? `（${range.contentDate}）` : ""}`,
);

const ing = await ingest(db, config, date, range);
console.log(`  入库：${ing.files} 个账号文件，${ing.received} 条推文 → 保存 ${ing.stored}，规则排除 ${ing.filtered}，不在时间范围 ${ing.outOfRange}${ing.refetched ? `，补抓全文后重新评审 ${ing.refetched}` : ""}`);
for (const f of ing.invalidFiles) console.warn(`  ⚠ 文件格式不符 ${f.file}：\n${f.error}`);
for (const h of ing.unknownAccounts) console.warn(`  ⚠ ${h} 不在 topics.yaml 中，已忽略`);
for (const b of ing.blocked) console.warn(`  ⚠ 采集异常 @${b.handle}：${b.status}${b.error ? `（${b.error}）` : ""}`);
if (ing.truncated > 0) console.warn(`  ⚠ ${ing.truncated} 条长推文仍是截断版（未补抓详情页），邮件中会提示"全文较长"`);

const candidates = await pickCandidates(db, config, range);
console.log(`  候选：${candidates.length} 条送去评审`);

const reviewer = values["skip-ai"]
  ? createRuleOnlyReviewer(new Map(candidates.map((c) => [c.id, c.ruleScore ?? 0])))
  : createLlmReviewer();
const rev = await reviewCandidates(db, config, candidates, reviewer);
console.log(`  评审：完成 ${rev.reviewed} 条${rev.failed.length ? `，失败 ${rev.failed.length} 条` : ""}`);
for (const f of rev.failed.slice(0, 5)) console.warn(`  ⚠ ${f.id}：${f.error}`);

const mailer = dryRun ? undefined : createResendMailer();
const sent = await sendDigests(db, config, { date, range, now, dryRun, mailer });
if (dryRun) {
  console.log(`  邮件预览：`);
  for (const p of sent.previews) console.log(`    ${p}`);
} else {
  console.log(`  发送：成功 ${sent.sent}，今日已发过 ${sent.alreadySent}，无内容跳过 ${sent.skippedEmpty}，失败 ${sent.failed.length}`);
  for (const f of sent.failed) console.warn(`  ⚠ ${f.email}：${f.error}`);
}

if (ing.blocked.length > 0) {
  console.warn("\n采集端报告了限流或登录问题，请检查专用账号状态后再运行采集。");
  process.exitCode = 2;
}
