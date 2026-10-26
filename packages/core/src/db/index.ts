import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { inArray } from "drizzle-orm";
import type { LinkDigest } from "../types.ts";
import { findRepoRoot } from "../config.ts";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

function defaultUrl(): string {
  return `file:${join(findRepoRoot(), "data", "app.db")}`;
}

export function createDb(url = process.env.DATABASE_URL || defaultUrl(), authToken = process.env.DATABASE_AUTH_TOKEN || undefined) {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

let shared: Db | undefined;
export function getDb(): Db {
  shared ??= createDb();
  return shared;
}

/** 执行 packages/core/drizzle 下的迁移，建表或升级表结构 */
export async function migrateDb(db: Db = getDb()): Promise<void> {
  await migrate(db, { migrationsFolder: join(findRepoRoot(), "packages", "core", "drizzle") });
}
export * from "./subscribers-report.ts";
export * from "./feedback.ts";

/** 外部文章摘要缓存：按链接批量读取（流水线和网站共用） */
export async function loadLinkDigests(db: Db, urls: string[]): Promise<Map<string, LinkDigest>> {
  const unique = [...new Set(urls)];
  if (unique.length === 0) return new Map();
  const rows = await db.select().from(schema.linkDigests).where(inArray(schema.linkDigests.url, unique));
  return new Map(rows.map((r) => [r.url, r.data]));
}
