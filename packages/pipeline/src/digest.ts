import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeTopicIds,
  qualityOf,
  resolveTopicId,
  type AppConfig,
  dateLabel,
  type DigestView,
  findRepoRoot,
  type Lang,
  type LinkDigest,
  primaryArticle,
  monthDayLabel,
  selectForSubscriber,
  startOfLocalDay,
  type TimeRange,
  toCardView,
} from "@xrss/core";
import { type Db, deliveries, subscribers, tweets, type SubscriberRow, type TweetRow } from "@xrss/core/db";
import { GMAIL_CLIP_BYTES, renderDigest } from "@xrss/emails";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { loadDigests } from "./links.ts";
import type { Mailer } from "./mailer.ts";
import { inBatch } from "./batch.ts";

const siteBase = () => (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");

/** 单独发送时的专属链接（带订阅者 token） */
export function siteLinks(token: string, lang: Lang) {
  const site = siteBase();
  return {
    manage: `${site}/preferences/${token}`,
    switchLang: `${site}/api/preferences/${token}/lang?to=${lang === "zh" ? "orig" : "zh"}`,
    unsubscribe: `${site}/unsubscribe/${token}`,
    rss: `${site}/#rss`,
  };
}

/** 合并发送时的通用链接：打开后输入邮箱，系统把专属管理链接发到该邮箱 */
export function sharedLinks(lang: Lang) {
  const site = siteBase();
  return {
    manage: `${site}/manage`,
    switchLang: `${site}/manage?action=lang&to=${lang === "zh" ? "orig" : "zh"}`,
    unsubscribe: `${site}/manage?action=unsubscribe`,
    rss: `${site}/#rss`,
  };
}

/** 主题组合和语言相同的订阅者收到的内容完全一样 */
export function groupKey(sub: { lang: Lang; topics: string[] }): string {
  return `${sub.lang}|${[...sub.topics].sort().join(",")}`;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface DigestContext {
  config: AppConfig;
  date: string;
  now: Date;
  range: TimeRange;
  scored: TweetRow[];
  /** 文章链接 → 抓取结果和摘要 */
  articles: Map<string, LinkDigest>;
  /** 窗口内每个账号的新推文数，用于"从 N 条新推文中筛选" */
  scannedByHandle: Map<string, number>;
}

export function buildView(
  ctx: DigestContext,
  topicIds: string[],
  lang: Lang,
  links: DigestView["links"],
  personalLinks = true,
): DigestView | null {
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
    // 用运行日期（邮件所属日期）而不是当前时刻，补跑历史日期时标题也正确
    dateLabel: dateLabel(new Date(startOfLocalDay(ctx.date, config.digest.timezone).getTime() + 12 * 3_600_000), config.digest.timezone),
    periodLabel: config.digest.collect_window === "previous_day" ? monthDayLabel(ctx.range.contentDate) : undefined,
    lang,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    topicCount: topicOrder.length,
    accountCount: handles.size,
    scannedCount: [...handles].reduce((n, h) => n + (ctx.scannedByHandle.get(h) ?? 0), 0),
    groups: groups.map((g) => {
      const topic = config.topics.find((t) => t.id === g.topicId)!;
      return {
        topic: { id: topic.id, name: topic.name, color: topic.color },
        items: g.items.map(({ row }) => {
          const p = primaryArticle(row.raw);
          const article = p ? ctx.articles.get(p.link.expandedUrl) : undefined;
          return toCardView({ id: row.id, topicId: row.topicId!, kind: row.kind, raw: row.raw, ai: row.ai, article }, viewOpts);
        }),
      };
    }),
    links,
    personalLinks,
  };
}

export interface SendStats {
  /** 成功送达的收件人数 */
  sent: number;
  /** 实际调用 SMTP 发出的邮件封数 */
  messages: number;
  /** 合并发送的分组数（同一主题组合 + 语言，且不止一人） */
  sharedGroups: number;
  skippedEmpty: number;
  alreadySent: number;
  failed: Array<{ email: string; error: string }>;
  previews: string[];
}

type Target = Pick<SubscriberRow, "email" | "lang" | "topics" | "token"> & { id?: number };

export async function sendDigests(
  db: Db,
  config: AppConfig,
  opts: { date: string; range: TimeRange; now: Date; dryRun: boolean; mailer?: Mailer },
): Promise<SendStats> {
  const stats: SendStats = { sent: 0, messages: 0, sharedGroups: 0, skippedEmpty: 0, alreadySent: 0, failed: [], previews: [] };
  const mailCfg = config.digest.mail;

  const windowRows = await db
    .select({ handle: tweets.handle, status: tweets.status, id: tweets.id })
    .from(tweets)
    .where(and(inBatch(opts.range), inArray(tweets.handle, config.accounts)));
  const scannedByHandle = new Map<string, number>();
  for (const r of windowRows) scannedByHandle.set(r.handle, (scannedByHandle.get(r.handle) ?? 0) + 1);

  const scored = (
    await db
      .select()
      .from(tweets)
      .where(and(eq(tweets.status, "scored"), inBatch(opts.range)))
  )
    // 主题合并后，旧推文上的旧主题 id 映射到新主题
    .map((t) => ({ ...t, topicId: resolveTopicId(config, t.topicId) ?? null }))
    .filter((t) => t.topicId && qualityOf(t.ai) >= config.digest.filters.min_quality);
  const articleUrls = scored.map((t) => primaryArticle(t.raw)?.link.expandedUrl).filter((u): u is string => Boolean(u));
  const articles = await loadDigests(db, articleUrls);
  const ctx: DigestContext = { config, date: opts.date, now: opts.now, range: opts.range, scored, articles, scannedByHandle };

  const active = (await db.select().from(subscribers).where(eq(subscribers.status, "active")))
    // 老订阅者选的旧主题映射到合并后的新主题
    .map((s) => ({ ...s, topics: normalizeTopicIds(config, s.topics) }))
    .filter((s) => s.topics.length > 0);
  const outDir = join(findRepoRoot(), "data", "out", opts.date);

  // 试跑且还没有订阅者时，按"订阅全部主题"各渲染一份中文版和原文版
  let targets: Target[] =
    opts.dryRun && active.length === 0
      ? (["zh", "orig"] as const).map((lang) => ({ email: `sample-${lang}`, lang, topics: config.topics.map((t) => t.id), token: "preview" }))
      : active;

  // 今天已经发过的不再发
  if (!opts.dryRun && targets.length > 0) {
    const done = await db
      .select({ subscriberId: deliveries.subscriberId })
      .from(deliveries)
      .where(and(eq(deliveries.digestDate, opts.date), eq(deliveries.status, "sent")));
    const doneIds = new Set(done.map((d) => d.subscriberId));
    const before = targets.length;
    targets = targets.filter((t) => t.id === undefined || !doneIds.has(t.id));
    stats.alreadySent = before - targets.length;
  }

  // 按"语言 + 主题组合"分组：同组内容完全一样
  const groups = new Map<string, Target[]>();
  for (const t of targets) groups.set(groupKey(t), [...(groups.get(groupKey(t)) ?? []), t]);

  const record = async (sub: Target, tweetIds: string[], result: { status: "sent"; messageId: string } | { status: "failed"; error: string }) => {
    if (sub.id === undefined) return;
    const values =
      result.status === "sent"
        ? { subscriberId: sub.id, digestDate: opts.date, tweetIds, messageId: result.messageId, status: "sent" as const, error: null }
        : { subscriberId: sub.id, digestDate: opts.date, tweetIds, status: "failed" as const, error: result.error };
    await db
      .insert(deliveries)
      .values(values)
      .onConflictDoUpdate({
        target: [deliveries.subscriberId, deliveries.digestDate],
        set: { status: values.status, messageId: "messageId" in values ? values.messageId : null, error: values.error, tweetIds, sentAt: new Date() },
      });
    if (result.status === "sent") stats.sent++;
    else stats.failed.push({ email: sub.email, error: result.error });
  };

  const warnSize = (html: string, who: string) => {
    if (Buffer.byteLength(html) > GMAIL_CLIP_BYTES) console.warn(`⚠ 发给 ${who} 的邮件超过 102KB，Gmail 会折叠末尾内容`);
  };

  for (const members of groups.values()) {
    const { lang, topics } = members[0]!;
    const shared = mailCfg.group_identical && members.length > 1;

    if (shared) {
      // 合并发送：只渲染一次，用通用链接，收件人放在密送里分批发出
      stats.sharedGroups++;
      const links = sharedLinks(lang);
      const view = buildView(ctx, topics, lang, links, false);
      if (!view) {
        stats.skippedEmpty += members.length;
        continue;
      }
      const email = await renderDigest(view);
      warnSize(email.html, `${members.length} 位订阅者`);
      const tweetIds = view.groups.flatMap((g) => g.items.map((i) => i.id));

      if (opts.dryRun) {
        mkdirSync(outDir, { recursive: true });
        const path = join(outDir, `group-${lang}-${[...topics].sort().join("_")}-${members.length}人.html`);
        writeFileSync(path, email.html);
        stats.previews.push(path);
        continue;
      }

      for (const batch of chunk(members, mailCfg.bcc_batch_size)) {
        try {
          const res = await opts.mailer!.send({
            to: opts.mailer!.address,
            bcc: batch.map((m) => m.email),
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: { "List-Unsubscribe": `<${links.unsubscribe}>` },
          });
          stats.messages++;
          const rejected = new Set(res.rejected.map((r) => r.toLowerCase()));
          for (const m of batch) {
            await record(m, tweetIds, rejected.has(m.email.toLowerCase()) ? { status: "failed", error: "收件地址被拒收" } : { status: "sent", messageId: res.id });
          }
        } catch (e) {
          const error = (e as Error).message;
          for (const m of batch) await record(m, tweetIds, { status: "failed", error });
        }
      }
      continue;
    }

    // 单独发送：带专属的管理、切换语言和一键退订链接
    for (const sub of members) {
      const links = siteLinks(sub.token, sub.lang);
      const view = buildView(ctx, sub.topics, sub.lang, links, true);
      if (!view) {
        stats.skippedEmpty++;
        continue;
      }
      const email = await renderDigest(view);
      warnSize(email.html, sub.email);

      if (opts.dryRun) {
        mkdirSync(outDir, { recursive: true });
        const path = join(outDir, `${sub.email.replace(/[^\w.-]+/g, "_")}.html`);
        writeFileSync(path, email.html);
        stats.previews.push(path);
        continue;
      }

      const tweetIds = view.groups.flatMap((g) => g.items.map((i) => i.id));
      try {
        const res = await opts.mailer!.send({
          to: sub.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        stats.messages++;
        await record(sub, tweetIds, { status: "sent", messageId: res.id });
      } catch (e) {
        await record(sub, tweetIds, { status: "failed", error: (e as Error).message });
      }
    }
  }
  return stats;
}
