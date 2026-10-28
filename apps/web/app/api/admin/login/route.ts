import { ADMIN_COOKIE, adminEnabled, isAdmin, newAdminSession, passwordMatches, rotateSessionSecret } from "@/lib/admin";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { SESSION_TTL_MS } from "@/lib/session-token";

/** 同一来源 10 分钟内最多输错 10 次；所有来源合计 1 小时最多输错 100 次，超出后暂停登录，防止换着来源暴力猜密码 */
const perIp = new RateLimiter(10, 10 * 60_000);
const allIps = new RateLimiter(100, 60 * 60_000);
const GLOBAL = "all";

export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ message: "未开放" }, { status: 404 });
  const ip = clientIp(req);
  if (perIp.blocked(ip)) return Response.json({ message: "尝试次数太多，请 10 分钟后再试" }, { status: 429 });
  if (allIps.blocked(GLOBAL)) return Response.json({ message: "密码错误次数太多，登录暂停 1 小时" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!passwordMatches(String(body.password ?? ""))) {
    perIp.hit(ip);
    allIps.hit(GLOBAL);
    return Response.json({ message: "密码不对" }, { status: 401 });
  }
  perIp.reset(ip);
  const res = Response.json({ ok: true });
  // 经 Cloudflare Tunnel 等反向代理访问时，本机收到的是 http，原始协议在 x-forwarded-proto 里
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(req.url).protocol.replace(/:$/, "");
  const secure = proto === "https" ? "; Secure" : "";
  res.headers.append("set-cookie", `${ADMIN_COOKIE}=${newAdminSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
  return res;
}

/** 退出：换掉会话密钥，所有设备上的登录（包括被拷走的 cookie）一起失效 */
export async function DELETE() {
  if (await isAdmin()) rotateSessionSecret();
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}
