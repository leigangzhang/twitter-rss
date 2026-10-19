import { resendTo, retryFailed, sendMissing } from "@xrss/pipeline/delivery";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { config, db, getDigestMailer } from "@/lib/server";

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["resend", "retry", "missing"]),
  subscriberId: z.number().int().optional(),
});

/** 重新推送：resend 发给某一位；retry 重试这一期失败的；missing 补发给这一期没收到的 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "参数有误" }, { status: 400 });
  const { date, action, subscriberId } = parsed.data;
  const mailer = getDigestMailer();
  if (!mailer) return Response.json({ message: "没有配置 SMTP_USER / SMTP_PASS，无法发送" }, { status: 400 });
  const d = await db();
  const cfg = config();

  if (action === "resend") {
    if (subscriberId === undefined) return Response.json({ message: "缺少订阅者" }, { status: 400 });
    const r = await resendTo(d, cfg, mailer, date, subscriberId);
    return Response.json({ ok: r.status === "sent", message: `${r.email}：${r.message}` }, { status: r.status === "failed" ? 502 : 200 });
  }
  if (action === "retry") {
    const results = await retryFailed(d, cfg, mailer, date);
    const ok = results.filter((r) => r.status === "sent").length;
    return Response.json({ ok: true, message: results.length ? `重试 ${results.length} 位：成功 ${ok}，失败 ${results.length - ok}` : "没有发送失败的订阅者" });
  }
  const s = await sendMissing(d, cfg, mailer, date);
  return Response.json({ ok: true, message: `补发：成功 ${s.sent}，失败 ${s.failed.length}${s.skippedEmpty ? `，${s.skippedEmpty} 位没有对应主题的内容` : ""}` });
}
