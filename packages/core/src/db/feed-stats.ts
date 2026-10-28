import { createHash } from "node:crypto";
import { and, gte, lt, sql } from "drizzle-orm";
import type { Db } from "./index.ts";
import { feedReaders } from "./schema.ts";

/**
 * RSS 订阅统计：每次抓取 /feed/<主题>.<语言>.xml 时记一笔（按天、地址、读者汇总），后台按此估算订阅人数。
 * 不存 IP 和完整的 User-Agent，只存摘要和识别出的阅读器名。
 */

/** 会在 User-Agent 里报告订阅数的聚合服务：整个服务记成一个读者，人数取它报告的数 */
const AGGREGATORS: Array<[name: string, pattern: RegExp]> = [
  ["Feedly", /feedly/i],
  ["Inoreader", /inoreader/i],
  ["NewsBlur", /newsblur/i],
  ["The Old Reader", /theoldreader/i],
  ["Feedbin", /feedbin/i],
  ["Bazqux", /bazqux/i],
  ["Feeder", /feeder\.co/i],
];

/** 普通阅读器：按来源去重，每个算 1 人 */
const READERS: Array<[name: string, pattern: RegExp]> = [
  ["Folo", /folo|follow\//i],
  ["NetNewsWire", /netnewswire/i],
  ["Reeder", /reeder/i],
  ["ReadKit", /readkit/i],
  ["Unread", /unread/i],
  ["Miniflux", /miniflux/i],
  ["FreshRSS", /freshrss/i],
  ["Tiny Tiny RSS", /tiny tiny rss|tt-rss/i],
  ["Thunderbird", /thunderbird/i],
  ["Readwise", /readwise/i],
  ["RSS Guard", /rssguard/i],
  ["Fluent Reader", /fluent ?reader/i],
  ["NewsNow", /newsnow/i],
];

export interface FeedClient {
  client: string;
  /** 聚合服务报告的订阅数 */
  subscribers?: number;
  aggregator: boolean;
}

/** 从 User-Agent 认出阅读器，以及聚合服务报告的订阅数（"16 subscribers" / "9 readers"） */
export function parseFeedClient(ua: string): FeedClient {
  const count = /(\d+)\s+(?:subscribers?|readers?)/i.exec(ua);
  const subscribers = count ? Number(count[1]) : undefined;
  for (const [name, re] of AGGREGATORS) if (re.test(ua)) return { client: name, subscribers, aggregator: true };
  for (const [name, re] of READERS) if (re.test(ua)) return { client: name, subscribers, aggregator: false };
  if (subscribers !== undefined) return { client: "其他聚合服务", subscribers, aggregator: false };
  if (/mozilla|chrome|safari/i.test(ua) && !/bot|crawler|spider/i.test(ua)) return { client: "浏览器或未识别", aggregator: false };
  return { client: ua.trim() ? "其他" : "未知", aggregator: false };
}

/** 匿名读者标识：聚合服务用服务名，其他用 IP + User-Agent 的摘要（不可还原） */
export function readerKey(client: FeedClient, ip: string, ua: string): string {
  if (client.aggregator) return `svc:${client.client}`;
  return createHash("sha256").update(`xrss-feed:${ip}:${ua}`).digest("hex").slice(0, 16);
}

export interface FeedHit {
  date: string;
  slug: string;
  ip: string;
  userAgent: string;
}

/** 记一次抓取：同一天、同一地址、同一读者只记一行，累加次数 */
export async function recordFeedHit(db: Db, hit: FeedHit, now = new Date()): Promise<void> {
  const client = parseFeedClient(hit.userAgent);
  const subs = client.subscribers ?? null;
  await db
    .insert(feedReaders)
    .values({ date: hit.date, slug: hit.slug, readerKey: readerKey(client, hit.ip, hit.userAgent), client: client.client, subscribers: subs, lastAt: now })
    .onConflictDoUpdate({
      target: [feedReaders.date, feedReaders.slug, feedReaders.readerKey],
      set: {
        hits: sql`${feedReaders.hits} + 1`,
        lastAt: now,
        subscribers: subs === null ? sql`${feedReaders.subscribers}` : sql`max(coalesce(${feedReaders.subscribers}, 0), ${subs})`,
      },
    });
}

export interface FeedStat {
  slug: string;
  /** 估算订阅人数：聚合服务取报告数的最大值，其他读者每个算 1 */
  readers: number;
  hits: number;
  lastAt: Date | null;
}

export interface ClientStat {
  client: string;
  readers: number;
  aggregator: boolean;
}

export interface FeedStats {
  /** 统计区间 [from, to)，本地日期 */
  from: string;
  to: string;
  readers: number;
  hits: number;
  feeds: Map<string, FeedStat>;
  clients: ClientStat[];
  /** 第一条记录的日期；还没有记录时为 null */
  since: string | null;
}

const AGGREGATOR_NAMES = new Set(AGGREGATORS.map(([n]) => n));

/** 汇总 [from, to) 区间：同一地址的同一读者在区间里只算一次，聚合服务取区间里报告的最大订阅数 */
export async function feedStats(db: Db, from: string, to: string): Promise<FeedStats> {
  const rows = await db
    .select({
      slug: feedReaders.slug,
      readerKey: feedReaders.readerKey,
      client: sql<string>`max(${feedReaders.client})`,
      subscribers: sql<number | null>`max(${feedReaders.subscribers})`,
      hits: sql<number>`sum(${feedReaders.hits})`,
      lastAt: sql<number>`max(${feedReaders.lastAt})`,
    })
    .from(feedReaders)
    .where(and(gte(feedReaders.date, from), lt(feedReaders.date, to)))
    .groupBy(feedReaders.slug, feedReaders.readerKey);
  const [first] = await db.select({ date: sql<string | null>`min(${feedReaders.date})` }).from(feedReaders);

  const feeds = new Map<string, FeedStat>();
  const clients = new Map<string, number>();
  for (const r of rows) {
    const people = r.subscribers ?? 1;
    const f = feeds.get(r.slug) ?? { slug: r.slug, readers: 0, hits: 0, lastAt: null };
    f.readers += people;
    f.hits += Number(r.hits);
    const last = new Date(Number(r.lastAt));
    if (!f.lastAt || last > f.lastAt) f.lastAt = last;
    feeds.set(r.slug, f);
    clients.set(r.client, (clients.get(r.client) ?? 0) + people);
  }
  const list = [...feeds.values()];
  return {
    from,
    to,
    readers: list.reduce((s, f) => s + f.readers, 0),
    hits: list.reduce((s, f) => s + f.hits, 0),
    feeds,
    clients: [...clients].map(([client, readers]) => ({ client, readers, aggregator: AGGREGATOR_NAMES.has(client) })).sort((a, b) => b.readers - a.readers),
    since: first?.date ?? null,
  };
}
