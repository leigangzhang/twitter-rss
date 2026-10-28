import { createHmac, timingSafeEqual } from "node:crypto";

/** 管理后台登录有效期 */
export const SESSION_TTL_MS = 8 * 3600_000;

const sign = (key: string, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/**
 * 签名用的密钥：服务端随机密钥 + 管理密码。
 * 换随机密钥（退出登录）或改密码，之前签出的令牌全部失效；cookie 被拿走也反推不出密码。
 */
export function sessionKey(secret: string, password: string): string {
  return createHmac("sha256", secret).update(`xrss-admin:${password}`).digest("hex");
}

/** 令牌格式 v1.<过期时间毫秒>.<签名> */
export function signSession(key: string, now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const payload = `v1.${now + ttlMs}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifySession(key: string, token: string, now = Date.now()): boolean {
  const m = /^(v1\.(\d{1,16}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || Number(m[2]) <= now) return false;
  const expected = Buffer.from(sign(key, m[1]!));
  const actual = Buffer.from(m[3]!);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
