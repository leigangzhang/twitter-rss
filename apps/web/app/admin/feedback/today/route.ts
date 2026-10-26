import { feedbackTarget } from "@xrss/pipeline/admin-preview";
import { isAdmin } from "@/lib/admin";
import { db, siteUrl } from "@/lib/server";

/**
 * 今日反馈：跳到最近一期（或 ?date=）"已发出的"完整预览，在里面点赞 / 踩。
 * 默认看管理员自己（ADMIN_EMAIL）收到的那份，?subscriber= 可以指定别人。
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.redirect(siteUrl("/admin/feedback"), 303);
  const q = new URL(req.url).searchParams;
  const date = q.get("date") ?? undefined;
  const sub = q.get("subscriber");
  if ((date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || (sub && !/^\d+$/.test(sub))) return new Response("参数有误", { status: 400 });
  const target = await feedbackTarget(await db(), { date, subscriberId: sub ? Number(sub) : undefined, adminEmail: process.env.ADMIN_EMAIL });
  if (!target) return new Response(date ? `${date} 这一期还没有发出` : "还没有发出过邮件", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.redirect(siteUrl(`/admin/deliveries/${target.date}/preview?subscriber=${target.subscriberId}&sent=1`), 303);
}
