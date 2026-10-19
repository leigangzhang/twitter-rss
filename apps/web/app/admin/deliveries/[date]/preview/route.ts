import { buildIssueEmail } from "@xrss/pipeline/delivery";
import { isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

/** 预览某位订阅者某一期的邮件：默认是"重新发送"会发出的最新内容；?sent=1 查看当时已经发出的 */
export async function GET(req: Request, ctx: { params: Promise<{ date: string }> }) {
  if (!(await isAdmin())) return new Response("未登录", { status: 401 });
  const { date } = await ctx.params;
  const id = Number(new URL(req.url).searchParams.get("subscriber"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(id)) return new Response("参数有误", { status: 400 });
  const mode = new URL(req.url).searchParams.get("sent") ? "sent" : "latest";
  const built = await buildIssueEmail(await db(), config(), date, id, mode);
  if ("error" in built) return new Response(built.error, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(built.email.html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
