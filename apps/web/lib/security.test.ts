import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "./rate-limit";
import { SESSION_TTL_MS, sessionKey, signSession, verifySession } from "./session-token";

describe("RateLimiter", () => {
  it("窗口内到上限后拒绝，过了窗口恢复", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 10)).toBe(true);
    expect(rl.take("a", 20)).toBe(false);
    expect(rl.take("b", 20)).toBe(true);
    expect(rl.take("a", 1010)).toBe(true);
  });

  it("reset 清掉计数", () => {
    const rl = new RateLimiter(1, 1000);
    rl.hit("a", 0);
    expect(rl.blocked("a", 1)).toBe(true);
    rl.reset("a");
    expect(rl.blocked("a", 1)).toBe(false);
  });

  it("key 数量不超过上限", () => {
    const rl = new RateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`k${i}`, i);
    expect(rl.size).toBeLessThanOrEqual(100);
    expect(rl.blocked("k999", 1000)).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

  it("优先 CF-Connecting-IP，不信任 X-Forwarded-For", () => {
    expect(clientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9" }))).toBe("local");
    expect(clientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });
});

describe("会话令牌", () => {
  const key = sessionKey("secret", "password");

  it("有效期内通过，过期后失效", () => {
    const token = signSession(key, 1_000);
    expect(verifySession(key, token, 1_000 + SESSION_TTL_MS - 1)).toBe(true);
    expect(verifySession(key, token, 1_000 + SESSION_TTL_MS)).toBe(false);
  });

  it("换密钥或改密码后失效", () => {
    const token = signSession(key, 0);
    expect(verifySession(sessionKey("other", "password"), token, 1)).toBe(false);
    expect(verifySession(sessionKey("secret", "changed"), token, 1)).toBe(false);
  });

  it("改过期时间、乱填都不通过", () => {
    const [v, , sig] = signSession(key, 0).split(".");
    expect(verifySession(key, `${v}.99999999999999.${sig}`, 1)).toBe(false);
    expect(verifySession(key, "", 1)).toBe(false);
    expect(verifySession(key, "a".repeat(64), 1)).toBe(false);
  });
});
