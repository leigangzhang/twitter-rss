import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot } from "@xrss/core";
import { cookies } from "next/headers";
import "@/lib/server"; // 读取仓库根目录的 .env
import { sessionKey, signSession, verifySession } from "@/lib/session-token";

/** 管理页只在 .env 里设置了 ADMIN_PASSWORD 时开放 */
export const ADMIN_COOKIE = "xrss_admin";

export function adminEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

const digest = (s: string) => createHash("sha256").update(`xrss-admin:${s}`).digest();

export function passwordMatches(input: string): boolean {
  return adminEnabled() && timingSafeEqual(digest(input), digest(process.env.ADMIN_PASSWORD ?? ""));
}

/**
 * 签名会话用的服务端随机密钥：优先用 .env 的 ADMIN_SESSION_SECRET；
 * 否则存在 data/admin-session.key（首次登录时生成），退出登录时换一个，所有设备上的登录一起失效。
 */
const secretFile = () => join(/*turbopackIgnore: true*/ findRepoRoot(), "data", "admin-session.key");
let secret: string | undefined;

function sessionSecret(): string {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET;
  if (secret) return secret;
  try {
    secret = readFileSync(secretFile(), "utf8").trim() || undefined;
  } catch {
    // 还没有，下面生成
  }
  return secret ?? rotateSessionSecret();
}

/** 换一个随机密钥；文件写不进去（只读部署）时只在内存里换，网站重启后需要重新登录 */
export function rotateSessionSecret(): string {
  secret = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(secretFile()), { recursive: true });
    writeFileSync(secretFile(), `${secret}\n`, { mode: 0o600 });
  } catch (e) {
    console.warn(`[admin] 会话密钥没能写入文件：${(e as Error).message}`);
  }
  return secret;
}

const key = () => sessionKey(sessionSecret(), process.env.ADMIN_PASSWORD ?? "");

/** 新的登录令牌，8 小时后过期（服务端校验） */
export function newAdminSession(): string {
  return signSession(key());
}

export async function isAdmin(): Promise<boolean> {
  if (!adminEnabled()) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return verifySession(key(), value);
}
