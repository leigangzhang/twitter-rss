import { parseArgs } from "node:util";
import { loadConfig, localDate, runRange, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { and, gte, inArray, lt } from "drizzle-orm";
import { createLlmEditor, createLlmReviewer, createLlmSummarizer, createRuleOnlyReviewer, describeLlm } from "./ai.ts";
import { fetchCandidateArticles, summarizeArticles } from "./links.ts";
import { runEditorial, writeCurationReport } from "./editorial.ts";
import { pickCandidates } from "./candidates.ts";
import { sendDigests } from "./digest.ts";
import { ingest } from "./ingest.ts";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";
import { reviewCandidates } from "./review.ts";
import { inBatch } from "./batch.ts";

loadDotEnv();

/**
 * 每日流水线：入库 → 规则粗筛 → AI 评审 → 按订阅者选稿 → 发送邮件
 *
 *   pnpm pipeline                 正式运行
 *   pnpm pipeline:dry             试跑：不发邮件，把邮件写到 data/out/<日期>/
 *   pnpm pipeline --skip-ai       不调用 AI，只用规则分（不翻译）
 *   pnpm pipeline --date 2026-10-18
 *   pnpm pipeline:dry --rereview  已评审过的推文按当前精选标准重新评审（调整 curation.md 后对比效果）
 */
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "skip-ai": { type: "boolean", default: false },
    rereview: { type: "boolean", default: false },
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
console.log(`  入库：${ing.files} 个账号文件，${ing.received} 条推文 → 保存 ${ing.stored}，规则排除 ${ing.filtered}，不在时间范围 ${ing.outOfRange}${ing.caughtUp ? `，补收前几天 ${ing.caughtUp}` : ""}${ing.refetched ? `，补抓全文后重新评审 ${ing.refetched}` : ""}`);
for (const f of ing.invalidFiles) console.warn(`  ⚠ 文件格式不符 ${f.file}：\n${f.error}`);
for (const h of ing.unknownAccounts) console.warn(`  ⚠ ${h} 不在 topics.yaml 中，已忽略`);
for (const b of ing.blocked) console.warn(`  ⚠ 采集异常 @${b.handle}：${b.status}${b.error ? `（${b.error}）` : ""}`);
for (const h of ing.missing) console.warn(`  ⚠ @${h} 不存在、已改名或被冻结，已跳过。请在 config/topics.yaml 里改正或删除`);
if (ing.truncated > 0) console.warn(`  ⚠ ${ing.truncated} 条长推文仍是截断版（未补抓详情页），邮件中会提示"全文较长"`);

if (values.rereview) {
  // 时间范围内已评审过的推文清空评审结果，重新排队
  const reset = await db
    .update(tweets)
    .set({ status: "new", ai: null, finalScore: null, topicId: null, filterReason: null })
    .where(and(inArray(tweets.status, ["scored", "rejected"]), inBatch(range)))
    .returning({ id: tweets.id });
  console.log(`  重新评审：${reset.length} 条已评审的推文按当前标准重新排队`);
}

const candidates = await pickCandidates(db, config, range);
console.log(`  候选：${candidates.length} 条送去评审`);

// 抓取候选推文里的外部文章（标题、封面、正文），供初审判断，也用于邮件里的文章卡片
const articles = await fetchCandidateArticles(db, config, candidates);
if (articles.byTweet.size > 0) {
  console.log(`  文章：${articles.byTweet.size} 条推文带外部文章，新抓取 ${articles.fetched} 篇${articles.failed ? `，失败 ${articles.failed} 篇（用 X 卡片信息兜底）` : ""}`);
}

const skipAi = values["skip-ai"]!;
const guide = config.curationGuide;
if (!skipAi) console.log(`  大模型：${describeLlm()}`);
const reviewer = skipAi
  ? createRuleOnlyReviewer(new Map(candidates.map((c) => [c.id, c.ruleScore ?? 0])))
  : createLlmReviewer({ guide });
const rev = await reviewCandidates(db, config, candidates, reviewer, { strict: !skipAi, articles: articles.byTweet });
console.log(
  `  初审：完成 ${rev.reviewed} 条，通过 ${rev.kept}，剔除 ${rev.rejected}${rev.failed.length ? `，失败 ${rev.failed.length}` : ""}${skipAi ? "（--skip-ai：未按类型过滤）" : ""}`,
);
for (const f of rev.failed.slice(0, 5)) console.warn(`  ⚠ ${f.id}：${f.error}`);

if (!skipAi && config.digest.curation.editor_pass) {
  try {
    const ed = await runEditorial(db, config, range, createLlmEditor({ guide }));
    console.log(`  终审：${ed.considered} 条候选，去掉重复 ${ed.dropped.length} 条`);
  } catch (e) {
    // 终审失败不影响发送，只是少了一道去重
    console.warn(`  ⚠ 终审失败，跳过去重：${(e as Error).message}`);
  }
}
if (!skipAi && config.digest.links.summarize) {
  const sum = await summarizeArticles(db, range, createLlmSummarizer());
  if (sum.summarized || sum.failed.length) {
    console.log(`  文章摘要：生成 ${sum.summarized} 篇${sum.failed.length ? `，失败 ${sum.failed.length} 篇（邮件里只显示标题和简介）` : ""}`);
  }
  for (const f of sum.failed.slice(0, 3)) console.warn(`  ⚠ ${f.url}：${f.error}`);
}
console.log(`  精选报告：${await writeCurationReport(db, config, range, date)}`);

let mailer: ReturnType<typeof createSmtpMailer> | undefined;
if (!dryRun) {
  const smtp = smtpConfigFromEnv();
  if (!smtp) throw new Error("缺少 SMTP_USER 或 SMTP_PASS（QQ 邮箱授权码）。试跑请加 --dry-run。");
  mailer = createSmtpMailer(smtp, { intervalMs: config.digest.mail.send_interval_ms });
}
const sent = await sendDigests(db, config, { date, range, now, dryRun, mailer });
mailer?.close();
if (dryRun) {
  console.log(`  邮件预览：`);
  for (const p of sent.previews) console.log(`    ${p}`);
} else {
  console.log(
    `  发送：送达 ${sent.sent} 人，共 ${sent.messages} 封邮件（${sent.sharedGroups} 组合并发送），今日已发过 ${sent.alreadySent}，无内容跳过 ${sent.skippedEmpty}，失败 ${sent.failed.length}`,
  );
  for (const f of sent.failed) console.warn(`  ⚠ ${f.email}：${f.error}`);
}

if (ing.blocked.length > 0) {
  console.warn("\n采集端报告了限流或登录问题，请检查专用账号状态后再运行采集。");
  process.exitCode = 2;
}
