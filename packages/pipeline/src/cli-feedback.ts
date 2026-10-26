import { parseArgs } from "node:util";
import { CATEGORY_LABELS, localDate, loadConfig, loadDotEnv, qualityOf } from "@xrss/core";
import { createDb, listFeedback, migrateDb, REASON_LABELS } from "@xrss/core/db";
import { summarizeFeedback } from "./feedback-summary.ts";

loadDotEnv();

/**
 * 反馈（读者在邮件里点的、管理员在后台预览里点的），新的在前：
 *   pnpm feedback               最近 50 条
 *   pnpm feedback --down        只看 👎
 *   pnpm feedback --limit 200
 *   pnpm feedback --summary [--days 7 | --from 2026-10-20 --to 2026-10-26]
 *                               汇总：👎 的每一条（账号、主题、类别、分数、AI 理由、原因和说明），以及按账号 / 主题 / 类别 / 原因的计数，用来改评审规则
 */
const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "50" },
    down: { type: "boolean", default: false },
    summary: { type: "boolean", default: false },
    days: { type: "string", default: "7" },
    from: { type: "string" },
    to: { type: "string" },
  },
});
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const tz = config.digest.timezone;
const fmt = (d: Date) => new Intl.DateTimeFormat("zh-CN", { timeZone: tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const oneLine = (s: string, n: number) => s.replace(/\s+/g, " ").slice(0, n);
const who = (f: { source: string; email: string | null }) => (f.source === "admin" ? "后台" : (f.email ?? "匿名"));

if (values.summary) {
  const DAY_MS = 86_400_000;
  const to = values.to ?? localDate(new Date(), tz);
  const from = values.from ?? localDate(new Date(new Date(`${to}T12:00:00Z`).getTime() - (Math.max(1, Number(values.days) || 7) - 1) * DAY_MS), "UTC");
  const list = await listFeedback(db, { from, to, limit: 5000 });
  const topicName = new Map(config.topics.map((t) => [t.id, t.name]));
  const s = summarizeFeedback(list);
  console.log(`${from} ~ ${to}：共 ${list.length} 条，👍 ${s.up}，👎 ${s.down.length}\n`);
  if (s.down.length === 0) process.exit(0);
  console.log("== 👎 明细 ==");
  for (const f of s.down) {
    const cat = f.ai?.category ? CATEGORY_LABELS[f.ai.category] : "?";
    const reason = [f.reason ? REASON_LABELS[f.reason] : null, f.note].filter(Boolean).join("：");
    console.log(`${f.issueDate}  @${f.handle ?? "?"}  ${topicName.get(f.topicId ?? "") ?? f.topicId ?? "?"}  ${cat}  ${f.ai ? qualityOf(f.ai) : "?"} 分  ${who(f)}`);
    if (reason) console.log(`  原因：${reason}`);
    if (f.ai?.reason) console.log(`  AI 理由：${oneLine(f.ai.reason, 120)}`);
    console.log(`  原文：${oneLine(f.text, 80)}`);
  }
  const print = (title: string, counts: Array<[string, number]>, label: (k: string) => string = (k) => k) => {
    console.log(`\n== 👎 按${title} ==`);
    for (const [k, n] of counts) console.log(`${String(n).padStart(3)}  ${label(k)}`);
  };
  print("账号", s.byHandle, (k) => `@${k}`);
  print("主题", s.byTopic, (k) => topicName.get(k) ?? k);
  print("类别", s.byCategory, (k) => CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS] ?? k);
  print("原因", s.byReason, (k) => (k in REASON_LABELS ? REASON_LABELS[k as keyof typeof REASON_LABELS] : k));
  process.exit(0);
}

const list = await listFeedback(db, { limit: Math.max(1, Number(values.limit) || 50), vote: values.down ? "down" : undefined });
if (list.length === 0) {
  console.log("还没有反馈");
  process.exit(0);
}
const up = list.filter((f) => f.vote === "up").length;
console.log(`${list.length} 条：👍 ${up}，👎 ${list.length - up}\n`);
for (const f of list) {
  const reason = [f.reason ? REASON_LABELS[f.reason] : null, f.note].filter(Boolean).join("：");
  console.log(`${fmt(f.updatedAt)}  ${f.issueDate}  ${f.vote === "up" ? "👍" : "👎"}${reason ? `（${reason}）` : ""}  @${f.handle ?? "?"}  ${oneLine(f.text, 40)}  ${who(f)}`);
}
