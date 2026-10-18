import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { db, siteUrl } from "@/lib/server";

/** 邮件底部"改为接收原文 / 中文"的一键切换 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const to = new URL(req.url).searchParams.get("to");
  if (to !== "zh" && to !== "orig") return Response.redirect(siteUrl(`/preferences/${token}`), 303);

  const d = await db();
  await d.update(subscribers).set({ lang: to, updatedAt: new Date() }).where(eq(subscribers.token, token));
  return Response.redirect(siteUrl(`/preferences/${token}?saved=lang`), 303);
}
