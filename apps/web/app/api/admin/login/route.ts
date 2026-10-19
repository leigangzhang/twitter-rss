import { ADMIN_COOKIE, adminEnabled, adminToken, passwordMatches } from "@/lib/admin";

/** 同一来源 10 分钟内最多试 10 次，防止暴力猜密码 */
const attempts = new Map<string, number[]>();

export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ message: "未开放" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 10) return Response.json({ message: "尝试次数太多，请 10 分钟后再试" }, { status: 429 });
  attempts.set(ip, [...recent, now]);

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!passwordMatches(body.password ?? "")) return Response.json({ message: "密码不对" }, { status: 401 });
  attempts.delete(ip);
  const res = Response.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  res.headers.append("set-cookie", `${ADMIN_COOKIE}=${adminToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}${secure}`);
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}
