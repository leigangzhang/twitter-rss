import { readInbox, smallAvatar } from "@xrss/collector";
import { type AppConfig, catchUpSince, cleanTweetText, engagement, mediaKind, ownMedia, passesFilters, type RawTweet, type TimeRange } from "@xrss/core";
import { accounts, type Db, tweets } from "@xrss/core/db";
import { eq, sql } from "drizzle-orm";

export interface IngestStats {
  files: number;
  received: number;
  stored: number;
  filtered: number;
  /** 不在本次时间范围内（早于补收起点，或是今天新发的） */
  outOfRange: number;
  /** 补收的前几天内容（账号上次没轮到） */
  caughtUp: number;
  /** 入库时仍是截断版的长推文 */
  truncated: number;
  /** 补抓到全文、需要重新评审的推文 */
  refetched: number;
  unknownAccounts: string[];
  invalidFiles: Array<{ file: string; error: string }>;
  blocked: Array<{ handle: string; status: string; error?: string }>;
}

const maxId = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a) return b ?? null;
  if (!b) return a;
  return BigInt(a) >= BigInt(b) ? a : b;
};

/** 从页面读取的推文会带进多余的断行（链接、@账号被拆开），入库前修好 */
function cleanRaw(t: RawTweet): RawTweet {
  return {
    ...t,
    text: cleanTweetText(t.text),
    thread: t.thread.map((p) => ({ ...p, text: cleanTweetText(p.text) })),
    quoted: t.quoted ? { ...t.quoted, text: cleanTweetText(t.quoted.text) } : undefined,
    media: ownMedia(t.media),
  };
}

/** 读取当天采集结果并入库；规则粗筛在这一步完成 */
export async function ingest(db: Db, config: AppConfig, date: string, range: TimeRange): Promise<IngestStats> {
  const inbox = readInbox(date);
  const stats: IngestStats = {
    files: inbox.files.length,
    received: 0,
    stored: 0,
    filtered: 0,
    outOfRange: 0,
    caughtUp: 0,
    refetched: 0,
    truncated: 0,
    unknownAccounts: [],
    invalidFiles: inbox.invalid,
    blocked: inbox.blocked,
  };
  const tracked = new Set(config.accounts);

  for (const file of inbox.files) {
    if (!tracked.has(file.handle)) {
      stats.unknownAccounts.push(file.handle);
      continue;
    }
    const own = file.tweets.filter((t) => t.author.handle === file.handle);
    stats.received += own.length;

    const [existing] = await db.select().from(accounts).where(eq(accounts.handle, file.handle));
    // 只记录范围结束前的推文：今天新发的推文明天还要采集，不能被当作"已看过"
    const newest = own.filter((t) => new Date(t.createdAt) < range.until).reduce<string | null>((m, t) => maxId(m, t.id), null);
    // 采集文件里的账号资料优先；没有时从推文作者信息里找（取带头像的那条）
    const fromTweets = own.find((t) => t.author.avatarUrl)?.author ?? own[0]?.author;
    const profile = { name: file.profile?.name ?? fromTweets?.name, avatarUrl: smallAvatar(file.profile?.avatarUrl ?? fromTweets?.avatarUrl) };
    // 账号上次没轮到时，从上次覆盖到的时间点开始补收（最多 catch_up_days 天）
    const since = catchUpSince(range, existing?.coveredUntil, config.crawl.catch_up_days);
    // 只有正常采完才推进覆盖时间点；采到一半被限流的，下次从原来的位置继续补
    const coveredUntil = file.status === "ok" ? new Date(Math.max(range.until.getTime(), existing?.coveredUntil?.getTime() ?? 0)) : existing?.coveredUntil;
    const latest = own.reduce<number>((m, t) => Math.max(m, new Date(t.createdAt).getTime()), 0);
    const lastTweetAt = latest ? new Date(Math.max(latest, existing?.lastTweetAt?.getTime() ?? 0)) : existing?.lastTweetAt;
    await db
      .insert(accounts)
      .values({
        handle: file.handle,
        name: profile?.name,
        avatarUrl: profile?.avatarUrl,
        lastSeenId: newest,
        lastCollectedAt: new Date(file.collectedAt),
        lastStatus: file.status,
        coveredUntil,
        lastTweetAt,
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: {
          name: profile?.name ?? existing?.name,
          avatarUrl: profile?.avatarUrl ?? existing?.avatarUrl,
          lastSeenId: maxId(existing?.lastSeenId, newest),
          lastCollectedAt: new Date(file.collectedAt),
          lastStatus: file.status,
          coveredUntil,
          lastTweetAt,
          updatedAt: new Date(),
        },
      });

    for (const original of own) {
      const t = cleanRaw(original);
      const at = new Date(t.createdAt);
      const [prev] = await db.select().from(tweets).where(eq(tweets.id, t.id));
      // 已入库的推文照常刷新（例如补抓到全文）；新推文只收补收起点之后、本次截止之前的
      if (at >= range.until || (!prev && at < since)) {
        stats.outOfRange++;
        continue;
      }
      if (!prev && at < range.since) stats.caughtUp++;
      const verdict = passesFilters(t, config.digest.filters);
      if (!verdict.ok) stats.filtered++;
      if (verdict.ok && t.textTruncated) stats.truncated++;
      await db
        .insert(tweets)
        .values({
          id: t.id,
          handle: file.handle,
          createdAt: new Date(t.createdAt),
          kind: mediaKind(t),
          raw: t,
          engagement: engagement(t),
          status: verdict.ok ? "new" : "filtered",
          filterReason: verdict.ok ? null : verdict.reason,
          batchDate: range.runDate ?? null,
        })
        // 再次采集到同一条推文时只刷新内容和互动数据，不重置处理状态
        .onConflictDoUpdate({ target: tweets.id, set: { raw: sql`excluded.raw`, engagement: sql`excluded.engagement` } });
      // 之前入库的是截断版、这次补抓到了全文：重新评审（翻译和打分都要基于全文）
      if (prev?.raw.textTruncated && !t.textTruncated && prev.status !== "new") {
        await db.update(tweets).set({ status: verdict.ok ? "new" : "filtered", ai: null, finalScore: null, topicId: null }).where(eq(tweets.id, t.id));
        stats.refetched++;
      }
      stats.stored++;
    }
  }
  return stats;
}
