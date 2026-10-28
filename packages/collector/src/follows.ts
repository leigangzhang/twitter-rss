import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AppConfig, findRepoRoot } from "@xrss/core";
import { smallAvatar } from "./parsers/x-graphql.ts";

/**
 * 把一个 X 账号的关注列表同步进 topics.yaml（pnpm follows:sync）。
 * 只新增、不自动删除：取关的账号记下来在后台提示；同步加进来的账号被手动移出后记为"不再同步"，以后不会再加回来。
 * 同步状态保存在 data/follow-sync.json。
 */

export interface FollowedUser {
  handle: string;
  name?: string;
  avatarUrl?: string;
}

/** 从"正在关注"页的 GraphQL 响应（Following）里取出关注对象，按出现顺序去重 */
export function parseFollowing(responses: unknown[]): FollowedUser[] {
  const out = new Map<string, FollowedUser>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 40) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, any>;
    const u = o.itemContent?.user_results?.result;
    if (o.itemContent?.itemType === "TimelineUser" && u) {
      const handle: unknown = u.core?.screen_name ?? u.legacy?.screen_name;
      if (typeof handle === "string" && /^[A-Za-z0-9_]{1,15}$/.test(handle) && !out.has(handle.toLowerCase())) {
        out.set(handle.toLowerCase(), { handle, name: u.core?.name ?? u.legacy?.name, avatarUrl: smallAvatar(u.avatar?.image_url ?? u.legacy?.profile_image_url_https) });
      }
      return;
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  for (const r of responses) visit(r, 0);
  return [...out.values()];
}

export interface FollowSyncState {
  /** 同步的是谁的关注列表 */
  handle?: string;
  lastSyncAt?: string;
  /** 上次读到的关注对象（小写） */
  following: string[];
  /** 上次是否读完了整个列表；没读完时不判断谁取关了 */
  complete: boolean;
  /** 由同步加进 topics.yaml 的账号（小写） */
  added: string[];
  /** 同步加进来、后来被手动移出的账号：不再同步 */
  ignored: string[];
  /** 加进来以后又取关了的账号（还在 topics.yaml 里），在后台提示是否移出 */
  unfollowed: string[];
  /** 最近一次的结果，后台显示 */
  last?: { at: string; ok: boolean; message: string; added: string[] };
}

export const EMPTY_SYNC: FollowSyncState = { following: [], complete: false, added: [], ignored: [], unfollowed: [] };

export function syncStatePath(): string {
  return join(/*turbopackIgnore: true*/ findRepoRoot(), "data", "follow-sync.json");
}

export function loadSyncState(path = syncStatePath()): FollowSyncState {
  if (!existsSync(path)) return structuredClone(EMPTY_SYNC);
  return { ...structuredClone(EMPTY_SYNC), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<FollowSyncState>) };
}

export function saveSyncState(state: FollowSyncState, path = syncStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** 到了自动同步的时间没有 */
export function syncDue(state: FollowSyncState, config: Pick<AppConfig, "crawl">, now = new Date()): boolean {
  const last = state.last?.ok ? state.lastSyncAt : undefined;
  return !last || now.getTime() - new Date(last).getTime() >= config.crawl.follow_sync.every_days * 86_400_000 - 3_600_000;
}

export interface SyncPlan {
  /** 要加进 topics.yaml 的账号（保留 X 上的大小写） */
  add: string[];
  /** 新记为"不再同步"的账号 */
  newlyIgnored: string[];
  /** 已在 topics.yaml、又取关了的同步账号 */
  unfollowed: string[];
  next: Omit<FollowSyncState, "last" | "lastSyncAt" | "handle">;
}

/**
 * 根据读到的关注列表算出要新增哪些账号（纯函数）：
 * 已在任何主题里的、自己、被手动移出过的都不加；列表没读完时不判断取关。
 */
export function planSync(state: FollowSyncState, following: FollowedUser[], tracked: string[], self: string, complete: boolean): SyncPlan {
  const inTopics = new Set(tracked.map((h) => h.toLowerCase()));
  // 同步加进来、现在已不在 topics.yaml 里的：是被手动移出的
  const newlyIgnored = state.added.filter((h) => !inTopics.has(h) && !state.ignored.includes(h));
  const ignored = new Set([...state.ignored, ...newlyIgnored]);
  const add = following.map((u) => u.handle).filter((h) => !inTopics.has(h.toLowerCase()) && !ignored.has(h.toLowerCase()) && h.toLowerCase() !== self.toLowerCase());
  const added = [...state.added.filter((h) => inTopics.has(h)), ...add.map((h) => h.toLowerCase())];
  const now = new Set(following.map((u) => u.handle.toLowerCase()));
  const unfollowed = complete ? added.filter((h) => !now.has(h)) : state.unfollowed.filter((h) => inTopics.has(h));
  return {
    add,
    newlyIgnored,
    unfollowed,
    next: { following: [...now], complete, added, ignored: [...ignored], unfollowed },
  };
}

/**
 * 同一时间只能有一个进程用采集的 Chrome（采集和同步关注）。锁文件 data/browser.lock 里记进程号，
 * 进程已经不在时视为没有锁。拿到锁返回 null，否则返回占用者的说明。
 */
export function browserLockPath(): string {
  return join(/*turbopackIgnore: true*/ findRepoRoot(), "data", "browser.lock");
}

export function lockHolder(path = browserLockPath()): { pid: number; what: string; at: string } | null {
  if (!existsSync(path)) return null;
  try {
    const lock = JSON.parse(readFileSync(path, "utf8")) as { pid: number; what: string; at: string };
    try {
      process.kill(lock.pid, 0);
    } catch (e) {
      // EPERM：进程在，只是不属于当前用户
      if ((e as NodeJS.ErrnoException).code !== "EPERM") return null;
    }
    return lock;
  } catch {
    return null;
  }
}

export function acquireBrowserLock(what: string, path = browserLockPath()): string | null {
  const holder = lockHolder(path);
  if (holder && holder.pid !== process.pid) return `${holder.what}正在使用采集的 Chrome（进程 ${holder.pid}，${holder.at} 开始）`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ pid: process.pid, what, at: new Date().toISOString() }));
  process.once("exit", () => {
    if (lockHolder(path)?.pid === process.pid) rmSync(path, { force: true });
  });
  return null;
}
