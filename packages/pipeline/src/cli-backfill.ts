import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { and, gte, inArray } from "drizzle-orm";
import { createLlmReviewer, describeLlm } from "./ai.ts";
import { fetchCandidateArticles } from "./links.ts";
import { reviewCandidates } from "./review.ts";

loadDotEnv();

/**
 * 补评审：最近 N 天采集了但没送评审的推文（以前每个主题每天有名额上限）逐条评审，
 * 只用来重算账号保留率：结果的状态记为 audited，不进邮件、RSS 和精选报告。
 *
 *   pnpm review:backfill              最近 14 天（crawl.yaml 的 account_quality.stats_days）
 *   pnpm review:backfill --days 7
 *   pnpm review:backfill --count      只统计要评审多少条，不调用 AI
 */
const { values } = parseArgs({
  options: {
    days: { type: "string" },
    count: { type: "boolean", default: false },
  },
});

const config = loadConfig();
const days = Math.max(1, Number(values.days ?? config.crawl.account_quality.stats_days) || 14);
const db = createDb();
await migrateDb(db);

const rows = await db
  .select()
  .from(tweets)
  .where(and(inArray(tweets.status, ["new", "failed"]), inArray(tweets.handle, config.accounts), gte(tweets.createdAt, new Date(Date.now() - days * 86_400_000))));
const chars = rows.reduce((s, r) => s + r.raw.text.length + (r.raw.quoted?.text.length ?? 0), 0);
console.log(`▶ 补评审最近 ${days} 天没评审的推文：${rows.length} 条，正文共约 ${Math.round(chars / 1000)} 千字`);
if (values.count || rows.length === 0) process.exit(0);

console.log(`  大模型：${describeLlm()}`);
const articles = await fetchCandidateArticles(db, config, rows);
if (articles.byTweet.size > 0) console.log(`  文章：${articles.byTweet.size} 条推文带外部文章，新抓取 ${articles.fetched} 篇`);
const rev = await reviewCandidates(db, config, rows, createLlmReviewer({ guide: config.curationGuide }), { strict: true, articles: articles.byTweet, audit: true });
console.log(`  完成 ${rev.reviewed} 条：判为保留 ${rev.kept}，剔除 ${rev.rejected}${rev.failed.length ? `，失败 ${rev.failed.length}（再运行一次会重试）` : ""}`);
for (const f of rev.failed.slice(0, 5)) console.warn(`  ⚠ ${f.id}：${f.error}`);
console.log("  运行 pnpm accounts 查看重算后的账号分档。");
