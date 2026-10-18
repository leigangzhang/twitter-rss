import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppConfig,
  dateLabel,
  type DigestView,
  findRepoRoot,
  type Lang,
  selectForSubscriber,
  toCardView,
} from "@xrss/core";
import { type Db, deliveries, subscribers, tweets, type SubscriberRow, type TweetRow } from "@xrss/core/db";
import { GMAIL_CLIP_BYTES, renderDigest } from "@xrss/emails";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Mailer } from "./mailer.ts";

export function siteLinks(token: string, lang: Lang) {
  const site = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    manage: `${site}/preferences/${token}`,
    switchLang: `${site}/api/preferences/${token}/lang?to=${lang === "zh" ? "orig" : "zh"}`,
    unsubscribe: `${site}/unsubscribe/${token}`,
    rss: `${site}/#rss`,
  };
}

interface DigestContext {
  config: AppConfig;
  date: string;
  now: Date;
  scored: TweetRow[];
  /** 窗口内每个账号的新推文数，用于"从 N 条新推文中筛选" */
  scannedByHandle: Map<string, number>;
}

export function buildView(ctx: DigestContext, topicIds: string[], lang: Lang, links: DigestView["links"]): DigestView | null {
  const { config } = ctx;
  const topicOrder = config.topics.map((t) => t.id).filter((id) => topicIds.includes(id));
  const groups = selectForSubscriber(
    ctx.scored.map((t) => ({ id: t.id, topicId: t.topicId!, finalScore: t.finalScore ?? 0, row: t })),
    { topicOrder, total: config.digest.digest.total_items, minPerTopic: config.digest.digest.min_per_topic },
  );
  if (groups.length === 0) return null;

  const viewOpts = { lang, timezone: config.digest.timezone, videoMode: config.digest.video_mode, maxThreadParts: config.digest.thread.max_parts, now: ctx.now };
  const handles = new Set(config.topics.filter((t) => topicOrder.includes(t.id)).flatMap((t) => t.accounts));
  return {
    date: ctx.date,
    dateLabel: dateLabel(ctx.now, config.digest.timezone),
    lang,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    topicCount: topicOrder.length,
    accountCount: handles.size,
    scannedCount: [...handles].reduce((n, h) => n + (ctx.scannedByHandle.get(h) ?? 0), 0),
    groups: groups.map((g) => {
      const topic = config.topics.find((t) => t.id === g.topicId)!;
      return {
        topic: { id: topic.id, name: topic.name, color: topic.color },
        items: g.items.map(({ row }) => toCardView({ id: row.id, topicId: row.topicId!, kind: row.kind, raw: row.raw, ai: row.ai }, viewOpts)),
      };
    }),
    links,
  };
}

export interface SendStats {
  sent: number;
  skippedEmpty: number;
  alreadySent: number;
  failed: Array<{ email: string; error: string }>;
  previews: string[];
}

export async function sendDigests(
  db: Db,
  config: AppConfig,
  opts: { date: string; since: Date; now: Date; dryRun: boolean; mailer?: Mailer },
): Promise<SendStats> {
  const stats: SendStats = { sent: 0, skippedEmpty: 0, alreadySent: 0, failed: [], previews: [] };

  const windowRows = await db
    .select({ handle: tweets.handle, status: tweets.status, id: tweets.id })
    .from(tweets)
    .where(and(gte(tweets.createdAt, opts.since), inArray(tweets.handle, config.accounts)));
  const scannedByHandle = new Map<string, number>();
  for (const r of windowRows) scannedByHandle.set(r.handle, (scannedByHandle.get(r.handle) ?? 0) + 1);

  const scored = (await db.select().from(tweets).where(and(eq(tweets.status, "scored"), gte(tweets.createdAt, opts.since)))).filter(
    (t) => t.topicId && (t.ai?.quality ?? 0) >= config.digest.filters.min_quality,
  );
  const ctx: DigestContext = { config, date: opts.date, now: opts.now, scored, scannedByHandle };

  const active = await db.select().from(subscribers).where(eq(subscribers.status, "active"));
  const outDir = join(findRepoRoot(), "data", "out", opts.date);

  // 试跑且还没有订阅者时，按"订阅全部主题"各渲染一份中文版和原文版
  const targets: Array<Pick<SubscriberRow, "email" | "lang" | "topics" | "token"> & { id?: number }> =
    opts.dryRun && active.length === 0
      ? (["zh", "orig"] as const).map((lang) => ({ email: `sample-${lang}`, lang, topics: config.topics.map((t) => t.id), token: "preview" }))
      : active;

  for (const sub of targets) {
    if (!opts.dryRun && sub.id !== undefined) {
      const [done] = await db
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.subscriberId, sub.id), eq(deliveries.digestDate, opts.date)));
      if (done?.status === "sent") {
        stats.alreadySent++;
        continue;
      }
    }

    const links = siteLinks(sub.token, sub.lang);
    const view = buildView(ctx, sub.topics, sub.lang, links);
    if (!view) {
      stats.skippedEmpty++;
      continue;
    }
    const email = await renderDigest(view);
    if (Buffer.byteLength(email.html) > GMAIL_CLIP_BYTES) {
      console.warn(`⚠ 发给 ${sub.email} 的邮件超过 102KB，Gmail 会折叠末尾内容`);
    }

    if (opts.dryRun) {
      mkdirSync(outDir, { recursive: true });
      const path = join(outDir, `${sub.email.replace(/[^\w.-]+/g, "_")}.html`);
      writeFileSync(path, email.html);
      stats.previews.push(path);
      continue;
    }

    const tweetIds = view.groups.flatMap((g) => g.items.map((i) => i.id));
    try {
      const { id } = await opts.mailer!.send({
        to: sub.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await db
        .insert(deliveries)
        .values({ subscriberId: sub.id!, digestDate: opts.date, tweetIds, messageId: id, status: "sent" })
        .onConflictDoUpdate({ target: [deliveries.subscriberId, deliveries.digestDate], set: { status: "sent", messageId: id, error: null, sentAt: new Date() } });
      stats.sent++;
    } catch (e) {
      const error = (e as Error).message;
      stats.failed.push({ email: sub.email, error });
      await db
        .insert(deliveries)
        .values({ subscriberId: sub.id!, digestDate: opts.date, tweetIds, status: "failed", error })
        .onConflictDoUpdate({ target: [deliveries.subscriberId, deliveries.digestDate], set: { status: "failed", error } });
    }
  }
  return stats;
}
