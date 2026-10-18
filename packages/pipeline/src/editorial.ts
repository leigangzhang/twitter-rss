import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, CATEGORY_LABELS, findRepoRoot, qualityOf, type TimeRange } from "@xrss/core";
import { type Db, deliveries, tweets, type TweetRow } from "@xrss/core/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Editor } from "./ai.ts";
import { loadAccountQuality, renderAccountReport } from "@xrss/collector";
import { inBatch } from "./batch.ts";

const REASON_LABELS = { same_event: "同一事件", duplicate: "重复观点", repeat_recent: "近几天已发过" } as const;

export interface EditorialStats {
  considered: number;
  dropped: Array<{ id: string; reason: string }>;
}

/**
 * 编辑终审：把时间范围内通过初审的推文放在一起，让模型去掉同一事件、相同观点，
 * 以及最近几天邮件里已经发过的内容。
 */
export async function runEditorial(db: Db, config: AppConfig, range: TimeRange, editor: Editor): Promise<EditorialStats> {
  const today = await db
    .select()
    .from(tweets)
    .where(and(eq(tweets.status, "scored"), inBatch(range)));
  const stats: EditorialStats = { considered: today.length, dropped: [] };
  if (today.length === 0) return stats;

  // 最近几天已发送的推文摘要
  const recentDays = config.digest.curation.recent_days;
  let recent: Array<{ id: string; summary: string }> = [];
  if (recentDays > 0) {
    const sent = await db
      .select({ tweetIds: deliveries.tweetIds })
      .from(deliveries)
      .where(and(eq(deliveries.status, "sent"), gte(deliveries.sentAt, new Date(range.since.getTime() - recentDays * 86_400_000))));
    const todayIds = new Set(today.map((t) => t.id));
    const ids = [...new Set(sent.flatMap((s) => s.tweetIds))].filter((id) => !todayIds.has(id));
    if (ids.length > 0) {
      const rows = await db.select({ id: tweets.id, ai: tweets.ai }).from(tweets).where(inArray(tweets.id, ids));
      recent = rows.filter((r) => r.ai?.summary).map((r) => ({ id: r.id, summary: r.ai!.summary }));
    }
  }

  const items = today.map((t) => ({
    id: t.id,
    author: `@${t.handle}`,
    topicId: t.topicId ?? "",
    category: t.ai?.category ?? "other",
    quality: qualityOf(t.ai),
    summary: t.ai?.summary || t.raw.text.slice(0, 80),
  }));
  const result = await editor.edit(items, recent);

  for (const d of result.drops) {
    const reason = `终审剔除：${REASON_LABELS[d.reason]}${d.keptId ? `（保留 ${d.keptId}）` : ""}：${d.note}`;
    await db.update(tweets).set({ status: "rejected", filterReason: reason.slice(0, 500) }).where(eq(tweets.id, d.id));
    stats.dropped.push({ id: d.id, reason });
  }
  return stats;
}

/**
 * 精选报告 data/out/<日期>/curation.md：列出入选和被剔除的推文及理由，
 * 用来检查 AI 的判断、调整 config/curation.md。
 */
export function renderCurationReport(rows: TweetRow[], range: TimeRange, date: string): string {
  const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const line = (t: TweetRow) => {
    const ai = t.ai;
    const head = `- [@${t.handle}](${t.raw.url})`;
    if (!ai) return `${head} ${t.raw.text.replace(/\s+/g, " ").slice(0, 80)}${t.filterReason ? ` — ${t.filterReason}` : ""}`;
    const tags = [CATEGORY_LABELS[ai.category] ?? ai.category, `${qualityOf(ai)}/5 分`, t.finalScore !== null ? `综合 ${t.finalScore.toFixed(2)}` : null]
      .filter(Boolean)
      .join(" · ");
    // 早期 --skip-ai 的结果没有 summary/reason；报告遇到旧数据也要能生成。
    const summary = oneLine(ai.summary) || t.raw.text.replace(/\s+/g, " ").slice(0, 80);
    const reason = oneLine(ai.reason) || "未记录理由";
    return `${head}（${tags}）${summary}\n  - 理由：${reason}${t.status === "rejected" ? `\n  - ${t.filterReason}` : ""}`;
  };

  const kept = rows.filter((t) => t.status === "scored").sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
  const rejected = rows.filter((t) => t.status === "rejected");
  const filtered = rows.filter((t) => t.status === "filtered");
  const pending = rows.filter((t) => t.status === "new" || t.status === "failed");

  return [
    `# 精选报告 ${date}`,
    "",
    `内容日期：${range.contentDate}　共 ${rows.length} 条：通过 ${kept.length}，AI 剔除 ${rejected.length}，规则排除 ${filtered.length}，未评审 ${pending.length}`,
    "",
    `AI 分数分布（5 分制）：${[5, 4, 3, 2, 1].map((n) => `${n} 分 ${rows.filter((t) => t.ai && Math.round(qualityOf(t.ai)) === n).length}`).join("，")}`,
    "",
    `## 通过精选（${kept.length}）`,
    "",
    ...kept.map(line),
    "",
    `## AI 剔除（${rejected.length}）`,
    "",
    ...rejected.map(line),
    "",
    `## 规则排除（${filtered.length}）`,
    "",
    ...filtered.map(line),
    "",
    `## 未评审（${pending.length}）`,
    "",
    "规则分没进前列（见 digest.yaml 的 candidates_per_topic）或评审失败的推文。",
    "",
    ...pending.map(line),
    "",
  ].join("\n");
}

export async function writeCurationReport(db: Db, config: AppConfig, range: TimeRange, date: string): Promise<string> {
  const rows = await db
    .select()
    .from(tweets)
    .where(and(inBatch(range), inArray(tweets.handle, config.accounts)));

  // 附上账号质量分档：哪些账号多采、哪些少采、哪些建议移出
  const quality = await loadAccountQuality(db, config);
  const md = `${renderCurationReport(rows, range, date)}\n## 账号质量\n\n${renderAccountReport(quality, config)}\n`;
  const dir = join(findRepoRoot(), "data", "out", date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "curation.md");
  writeFileSync(path, md);
  return path;
}
