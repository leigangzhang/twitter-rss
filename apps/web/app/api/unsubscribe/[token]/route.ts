import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { db, siteUrl } from "@/lib/server";

/**
 * 退订。既服务于退订页面的表单提交，
 * 也服务于邮件客户端的一键退订（List-Unsubscribe-Post）。
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const d = await db();
  await d.update(subscribers).set({ status: "unsubscribed", updatedAt: new Date() }).where(eq(subscribers.token, token));

  const isOneClick = (await req.text().catch(() => "")).includes("List-Unsubscribe=One-Click");
  if (isOneClick) return new Response(null, { status: 200 });
  return Response.redirect(siteUrl(`/unsubscribe/${token}?done=1`), 303);
}
