import { desc, eq } from "drizzle-orm";
import { type AppConfig, normalizeTopicIds } from "../config.ts";
import type { Lang } from "../types.ts";
import type { Db } from "./index.ts";
import { deliveries, subscribers } from "./schema.ts";

/** 订阅者一览（订阅者页面、pnpm subscribers 共用） */
export interface SubscriberInfo {
  id: number;
  email: string;
  lang: Lang;
  status: "pending" | "active" | "unsubscribed";
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date;
  /** 当前有效的主题（旧主题已按 aliases 映射） */
  topics: Array<{ id: string; name: string; color: string }>;
  /** 已失效、无法映射的旧主题 id */
  invalidTopics: string[];
  /** 最近一次成功发送的日期和累计成功次数 */
  lastSentDate: string | null;
  sentCount: number;
  /** 需要注意的问题，如"主题全部失效，收不到邮件" */
  issues: string[];
}

export const STATUS_LABELS: Record<SubscriberInfo["status"], string> = { active: "正常", pending: "待确认", unsubscribed: "已退订" };

export async function listSubscribers(db: Db, config: Pick<AppConfig, "topics" | "topicAliases">): Promise<SubscriberInfo[]> {
  const rows = await db.select().from(subscribers).orderBy(desc(subscribers.createdAt));
  const sent = await db.select({ subscriberId: deliveries.subscriberId, date: deliveries.digestDate }).from(deliveries).where(eq(deliveries.status, "sent"));
  const byTopic = new Map(config.topics.map((t) => [t.id, t]));

  return rows.map((r) => {
    const valid = normalizeTopicIds(config, r.topics);
    const invalidTopics = r.topics.filter((id) => normalizeTopicIds(config, [id]).length === 0);
    const mine = sent.filter((d) => d.subscriberId === r.id).map((d) => d.date).sort();
    const issues: string[] = [];
    if (r.status === "active" && valid.length === 0) issues.push("主题全部失效，收不到邮件");
    else if (invalidTopics.length) issues.push(`有 ${invalidTopics.length} 个主题已失效`);
    if (r.status === "pending" && Date.now() - r.createdAt.getTime() > 3 * 86_400_000) issues.push("超过 3 天未确认");
    return {
      id: r.id,
      email: r.email,
      lang: r.lang,
      status: r.status,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      updatedAt: r.updatedAt,
      topics: valid.map((id) => {
        const t = byTopic.get(id)!;
        return { id: t.id, name: t.name, color: t.color };
      }),
      invalidTopics,
      lastSentDate: mine.at(-1) ?? null,
      sentCount: mine.length,
      issues,
    };
  });
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 导出为 CSV（带 BOM，Excel 直接打开不乱码），时间按 timeZone 显示 */
export function subscribersCsv(list: SubscriberInfo[], timeZone: string): string {
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "";
  const header = ["ID", "邮箱", "状态", "语言", "主题", "失效主题", "订阅时间", "确认时间", "最近发送", "累计发送", "问题"];
  const lines = list.map((s) =>
    [
      String(s.id),
      s.email,
      STATUS_LABELS[s.status],
      s.lang === "zh" ? "中文" : "原文",
      s.topics.map((t) => t.name).join("；"),
      s.invalidTopics.join("；"),
      fmt(s.createdAt),
      fmt(s.confirmedAt),
      s.lastSentDate ?? "",
      String(s.sentCount),
      s.issues.join("；"),
    ]
      .map(csvCell)
      .join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\n")}\n`;
}
