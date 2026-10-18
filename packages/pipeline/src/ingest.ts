import { readInbox } from "@xrss/collector";
import { type AppConfig, engagement, mediaKind, passesFilters, type TimeRange } from "@xrss/core";
import { accounts, type Db, tweets } from "@xrss/core/db";
import { eq, sql } from "drizzle-orm";

export interface IngestStats {
  files: number;
  received: number;
  stored: number;
  filtered: number;
  /** 不在本次时间范围内（早于前一天，或是今天新发的） */
  outOfRange: number;
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

/** 读取当天采集结果并入库；规则粗筛在这一步完成 */
export async function ingest(db: Db, config: AppConfig, date: string, range: TimeRange): Promise<IngestStats> {
  const inbox = readInbox(date);
  const stats: IngestStats = {
    files: inbox.files.length,
    received: 0,
    stored: 0,
    filtered: 0,
    outOfRange: 0,
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
    const profile = own[0]?.author;
    await db
      .insert(accounts)
      .values({
        handle: file.handle,
        name: profile?.name,
        avatarUrl: profile?.avatarUrl,
        lastSeenId: newest,
        lastCollectedAt: new Date(file.collectedAt),
        lastStatus: file.status,
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: {
          name: profile?.name ?? existing?.name,
          avatarUrl: profile?.avatarUrl ?? existing?.avatarUrl,
          lastSeenId: maxId(existing?.lastSeenId, newest),
          lastCollectedAt: new Date(file.collectedAt),
          lastStatus: file.status,
          updatedAt: new Date(),
        },
      });

    for (const t of own) {
      const at = new Date(t.createdAt);
      if (at < range.since || at >= range.until) {
        stats.outOfRange++;
        continue;
      }
      const [prev] = await db.select().from(tweets).where(eq(tweets.id, t.id));
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
