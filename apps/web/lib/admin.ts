import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import "@/lib/server"; // 读取仓库根目录的 .env

/** 管理页只在 .env 里设置了 ADMIN_PASSWORD 时开放 */
export const ADMIN_COOKIE = "xrss_admin";

export function adminEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

/** cookie 里存密码的摘要，不存明文；改密码后旧 cookie 自动失效 */
export function adminToken(password = process.env.ADMIN_PASSWORD ?? ""): string {
  return createHash("sha256").update(`xrss-admin:${password}`).digest("hex");
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function passwordMatches(input: string): boolean {
  return adminEnabled() && same(adminToken(input), adminToken());
}

export async function isAdmin(): Promise<boolean> {
  if (!adminEnabled()) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return same(value, adminToken());
}
