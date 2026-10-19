import { type AppConfig, effectiveTopicId, monthDayLabel, normalizeTopicIds, qualityOf, runRange, startOfLocalDay, type DigestView } from "@xrss/core";
import {
  type Db,
  deliveries,
  deliveryAttempts,
  type DeliveryAttemptRow,
  type DeliveryRow,
  loadLinkDigests,
  subscribers,
  type SubscriberRow,
  tweets,
} from "@xrss/core/db";
import { primaryArticle } from "@xrss/core";
import { renderDigest, type RenderedEmail } from "@xrss/emails";
import { and, desc, eq, inArray } from "drizzle-orm";
import { buildView, loadDigestContext, type SendStats, sendDigests, siteLinks } from "./digest.ts";
import type { Mailer } from "./mailer.ts";

/**
 * 推送历史与重新推送（网站管理页和 pnpm resend 共用）。
 * - 每期的结果：deliveries（每人每期一条，最终状态）
 * - 每次发送的流水：delivery_attempts（定时、补发、重新发送、重试，只增不改）
 */

export type AttemptKind = DeliveryAttemptRow["kind"];
export const KIND_LABELS: Record<AttemptKind, string> = { scheduled: "定时发送", missing: "补发", resend: "重新发送", retry: "重试失败" };

export interface IssueSummary {
  /** 运行日期（邮件所属日期） */
  date: string;
  /** 内容日期，如"10月18日" */
  periodLabel: string;
  sent: number;
  failed: number;
  /** 当期已确认、但没有发送记录的正常订阅者 */
  missing: number;
  /** 当期发出的推文条数（所有收件人去重） */
  items: number;
  /** 发送尝试次数（含补发、重发） */
  attempts: number;
  lastSentAt: Date | null;
}

export interface IssueRecipient {
  subscriber: Pick<SubscriberRow, "id" | "email" | "lang" | "status">;
  /** missing：当期没有发送记录 */
  status: "sent" | "failed" | "missing";
  sentAt: Date | null;
  items: number;
  error: string | null;
  attempts: number;
}

export interface IssueItem {
  id: string;
  url: string;
  handle: string;
  name: string;
  topic: { id: string; name: string; color: string } | null;
  summary: string;
  quality: number;
  /** 收到这条的人数 */
  receivedBy: number;
}

export interface IssueDetail extends IssueSummary {
  recipients: IssueRecipient[];
  items: number;
  list: IssueItem[];
  log: Array<DeliveryAttemptRow & { email: string }>;
}

const periodOf = (config: AppConfig, date: string) => monthDayLabel(runRange(config, date).contentDate);

/** 某个订阅者在某一期应不应该收到：确认时间早于当期结束，且是正常订阅、主题有效 */
function expectedOn(config: AppConfig, s: SubscriberRow, date: string): boolean {
  if (s.status !== "active" || normalizeTopicIds(config, s.topics).length === 0) return false;
  const end = startOfLocalDay(date, config.digest.timezone).getTime() + 86_400_000;
  return (s.confirmedAt ?? s.createdAt).getTime() < end;
}

export async function listIssues(db: Db, config: AppConfig): Promise<IssueSummary[]> {
  const rows = await db.select().from(deliveries);
  const attempts = await db.select({ date: deliveryAttempts.digestDate }).from(deliveryAttempts);
  const subs = await db.select().from(subscribers);
  const byDate = new Map<string, DeliveryRow[]>();
  for (const r of rows) byDate.set(r.digestDate, [...(byDate.get(r.digestDate) ?? []), r]);

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => {
      const got = new Set(list.map((d) => d.subscriberId));
      return {
        date,
        periodLabel: periodOf(config, date),
        sent: list.filter((d) => d.status === "sent").length,
        failed: list.filter((d) => d.status === "failed").length,
        missing: subs.filter((s) => expectedOn(config, s, date) && !got.has(s.id)).length,
        items: new Set(list.flatMap((d) => d.tweetIds)).size,
        attempts: attempts.filter((a) => a.date === date).length,
        lastSentAt: list.reduce<Date | null>((m, d) => (!m || d.sentAt > m ? d.sentAt : m), null),
      };
    });
}

export async function issueDetail(db: Db, config: AppConfig, date: string): Promise<IssueDetail | null> {
  const list = await db.select().from(deliveries).where(eq(deliveries.digestDate, date));
  const log = await db.select().from(deliveryAttempts).where(eq(deliveryAttempts.digestDate, date)).orderBy(desc(deliveryAttempts.sentAt));
  if (list.length === 0 && log.length === 0) return null;
  const subs = await db.select().from(subscribers);
  const subById = new Map(subs.map((s) => [s.id, s]));

  const recipients: IssueRecipient[] = list.map((d) => {
    const s = subById.get(d.subscriberId)!;
    return {
      subscriber: { id: s.id, email: s.email, lang: s.lang, status: s.status },
      status: d.status,
      sentAt: d.sentAt,
      items: d.tweetIds.length,
      error: d.error,
      attempts: log.filter((a) => a.subscriberId === s.id).length,
    };
  });
  const got = new Set(list.map((d) => d.subscriberId));
  for (const s of subs.filter((x) => expectedOn(config, x, date) && !got.has(x.id))) {
    recipients.push({ subscriber: { id: s.id, email: s.email, lang: s.lang, status: s.status }, status: "missing", sentAt: null, items: 0, error: null, attempts: 0 });
  }
  const order = { failed: 0, missing: 1, sent: 2 };
  recipients.sort((a, b) => order[a.status] - order[b.status] || a.subscriber.email.localeCompare(b.subscriber.email));

  // 当期发出的推文：按收到的人数、质量分排序
  const counts = new Map<string, number>();
  for (const d of list) for (const id of d.tweetIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows = counts.size ? await db.select().from(tweets).where(inArray(tweets.id, [...counts.keys()])) : [];
  const items: IssueItem[] = rows
    .map((r) => {
      const topicId = effectiveTopicId(config, r.topicId, r.handle);
      const topic = config.topics.find((t) => t.id === topicId);
      return {
        id: r.id,
        url: r.raw.url,
        handle: r.raw.author.handle,
        name: r.raw.author.name,
        topic: topic ? { id: topic.id, name: topic.name, color: topic.color } : null,
        summary: r.ai?.summary || r.raw.text.replace(/\s+/g, " ").slice(0, 80),
        quality: qualityOf(r.ai),
        receivedBy: counts.get(r.id) ?? 0,
      };
    })
    .sort((a, b) => b.receivedBy - a.receivedBy || b.quality - a.quality);

  return {
    date,
    periodLabel: periodOf(config, date),
    sent: list.filter((d) => d.status === "sent").length,
    failed: list.filter((d) => d.status === "failed").length,
    missing: recipients.filter((r) => r.status === "missing").length,
    items: items.length,
    attempts: log.length,
    lastSentAt: list.reduce<Date | null>((m, d) => (!m || d.sentAt > m ? d.sentAt : m), null),
    recipients,
    list: items,
    log: log.map((a) => ({ ...a, email: subById.get(a.subscriberId)?.email ?? "（已删除）" })),
  };
}

/**
 * 生成某位订阅者某一期的邮件（带个人专属链接）：
 * - latest（默认，重新发送用）：按这一期现在的全部内容（含之后补采、重新评审的）和他现在的主题、语言重新挑选；
 * - sent：按当时发出的那几条推文重建，用来查看已经发出的邮件。
 */
export async function buildIssueEmail(
  db: Db,
  config: AppConfig,
  date: string,
  subscriberId: number,
  mode: "latest" | "sent" = "latest",
): Promise<{ subscriber: SubscriberRow; view: DigestView; email: RenderedEmail; tweetIds: string[] } | { subscriber?: SubscriberRow; error: string }> {
  const [sub] = await db.select().from(subscribers).where(eq(subscribers.id, subscriberId));
  if (!sub) return { error: "找不到这位订阅者" };
  const [delivery] = await db.select().from(deliveries).where(and(eq(deliveries.subscriberId, subscriberId), eq(deliveries.digestDate, date)));
  const range = runRange(config, date);
  // 卡片上的"昨天 / 今天"按当期发送时刻计算，重发时也和原邮件一致
  const now = mode === "sent" && delivery ? delivery.sentAt : new Date(Math.max(Date.now(), startOfLocalDay(date, config.digest.timezone).getTime() + 7 * 3_600_000));
  const ctx = await loadDigestContext(db, config, date, range, now);
  const links = siteLinks(sub.token, sub.lang);

  let view: DigestView | null;
  if (mode === "sent") {
    if (!delivery || delivery.tweetIds.length === 0) return { subscriber: sub, error: "这一期还没有发给这位订阅者" };
    const rows = (await db.select().from(tweets).where(inArray(tweets.id, delivery.tweetIds))).map((t) => ({
      ...t,
      topicId: effectiveTopicId(config, t.topicId, t.handle) ?? null,
    }));
    const articles = await loadLinkDigests(
      db,
      rows.map((t) => primaryArticle(t.raw)?.link.expandedUrl).filter((u): u is string => Boolean(u)),
    );
    const topics = config.topics.map((t) => t.id).filter((id) => rows.some((r) => r.topicId === id));
    view = buildView({ ...ctx, scored: rows.filter((r) => r.topicId), articles }, topics, sub.lang, links, true);
  } else {
    view = buildView(ctx, normalizeTopicIds(config, sub.topics), sub.lang, links, true);
  }
  if (!view) return { subscriber: sub, error: "这一期没有这位订阅者所选主题的内容" };
  const email = await renderDigest(view, { tabs: config.digest.mail.tabs, maxBytes: config.digest.mail.max_kb * 1024 });
  return { subscriber: sub, view, email, tweetIds: view.groups.flatMap((g) => g.items.map((i) => i.id)) };
}

export interface ResendResult {
  email: string;
  status: "sent" | "failed" | "skipped";
  message: string;
}

/** 给一位订阅者（重新）发送某一期：按这一期最新的内容，单独发送，带专属链接和一键退订 */
export async function resendTo(db: Db, config: AppConfig, mailer: Mailer, date: string, subscriberId: number, kind: "resend" | "retry" = "resend"): Promise<ResendResult> {
  // 按这一期最新的内容重新挑选（补采、重新评审之后的内容也会包含进来）
  const built = await buildIssueEmail(db, config, date, subscriberId, "latest");
  if ("error" in built) return { email: built.subscriber?.email ?? `#${subscriberId}`, status: "skipped", message: built.error };
  const { subscriber: sub, email, tweetIds } = built;
  const [before] = await db.select().from(deliveries).where(and(eq(deliveries.subscriberId, sub.id), eq(deliveries.digestDate, date)));
  const added = before?.status === "sent" ? tweetIds.filter((id) => !before.tweetIds.includes(id)).length : 0;
  const links = siteLinks(sub.token, sub.lang);

  let result: { status: "sent"; messageId: string } | { status: "failed"; error: string };
  try {
    const res = await mailer.send({
      to: sub.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    result = res.rejected.length ? { status: "failed", error: "收件地址被拒收" } : { status: "sent", messageId: res.id };
  } catch (e) {
    result = { status: "failed", error: (e as Error).message };
  }

  await db.insert(deliveryAttempts).values({
    subscriberId: sub.id,
    digestDate: date,
    kind,
    recipients: 1,
    tweetIds,
    status: result.status,
    messageId: result.status === "sent" ? result.messageId : null,
    error: result.status === "failed" ? result.error : null,
  });
  // 当期最终结果：发成功了就记成功；失败时不覆盖之前已经成功的记录
  const [prev] = await db.select().from(deliveries).where(and(eq(deliveries.subscriberId, sub.id), eq(deliveries.digestDate, date)));
  if (result.status === "sent" || prev?.status !== "sent") {
    const values = {
      tweetIds,
      status: result.status,
      messageId: result.status === "sent" ? result.messageId : null,
      error: result.status === "failed" ? result.error : null,
      sentAt: new Date(),
    };
    await db
      .insert(deliveries)
      .values({ subscriberId: sub.id, digestDate: date, ...values })
      .onConflictDoUpdate({ target: [deliveries.subscriberId, deliveries.digestDate], set: values });
  }
  return result.status === "sent"
    ? { email: sub.email, status: "sent", message: `已发送（${tweetIds.length} 条${added ? `，比上次多 ${added} 条新内容` : ""}）` }
    : { email: sub.email, status: "failed", message: result.error };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 重试某一期所有发送失败的订阅者 */
export async function retryFailed(db: Db, config: AppConfig, mailer: Mailer, date: string): Promise<ResendResult[]> {
  const failed = await db.select().from(deliveries).where(and(eq(deliveries.digestDate, date), eq(deliveries.status, "failed")));
  const results: ResendResult[] = [];
  for (const [i, d] of failed.entries()) {
    if (i > 0) await sleep(config.digest.mail.send_interval_ms);
    results.push(await resendTo(db, config, mailer, date, d.subscriberId, "retry"));
  }
  return results;
}

/** 补发某一期给还没收到的正常订阅者（按当期内容和他们现在的主题、语言挑选，同组合仍合并发送） */
export async function sendMissing(db: Db, config: AppConfig, mailer: Mailer, date: string): Promise<SendStats> {
  // 只补发给当期本该收到（当期结束前已确认）却没有任何发送记录的人，不给新订阅者补发旧内容
  const got = new Set((await db.select({ id: deliveries.subscriberId }).from(deliveries).where(eq(deliveries.digestDate, date))).map((d) => d.id));
  const onlyIds = (await db.select().from(subscribers)).filter((s) => expectedOn(config, s, date) && !got.has(s.id)).map((s) => s.id);
  if (onlyIds.length === 0) return { sent: 0, messages: 0, sharedGroups: 0, skippedEmpty: 0, alreadySent: 0, failed: [], previews: [] };
  return sendDigests(db, config, { date, range: runRange(config, date), now: new Date(), dryRun: false, mailer, kind: "missing", onlyIds });
}
