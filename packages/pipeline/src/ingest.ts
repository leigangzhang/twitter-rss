import { readInbox } from "@xrss/collector";
import { type AppConfig, engagement, mediaKind, passesFilters } from "@xrss/core";
import { accounts, type Db, tweets } from "@xrss/core/db";
import { eq, sql } from "drizzle-orm";

export interface IngestStats {
  files: number;
  received: number;
  stored: number;
  filtered: number;
  tooOld: number;
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
export async function ingest(db: Db, config: AppConfig, date: string, since: Date): Promise<IngestStats> {
  const inbox = readInbox(date);
  const stats: IngestStats = {
    files: inbox.files.length,
    received: 0,
    stored: 0,
    filtered: 0,
    tooOld: 0,
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
    const newest = own.reduce<string | null>((m, t) => maxId(m, t.id), null);
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
      if (new Date(t.createdAt) < since) {
        stats.tooOld++;
        continue;
      }
      const verdict = passesFilters(t, config.digest.filters);
      if (!verdict.ok) stats.filtered++;
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
      stats.stored++;
    }
  }
  return stats;
}
