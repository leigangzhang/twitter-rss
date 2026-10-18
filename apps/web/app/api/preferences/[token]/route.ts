import { subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { config, db } from "@/lib/server";
import { Preferences } from "@/lib/validation";

export async function PUT(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Preferences.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "参数有误" }, { status: 400 });

  const known = new Set(config().topics.map((t) => t.id));
  const topics = parsed.data.topics.filter((t) => known.has(t));
  if (topics.length === 0) return Response.json({ message: "至少选择一个主题" }, { status: 400 });

  const d = await db();
  const [sub] = await d.select().from(subscribers).where(eq(subscribers.token, token));
  if (!sub) return Response.json({ message: "链接已失效" }, { status: 404 });

  await d
    .update(subscribers)
    .set({ topics, lang: parsed.data.lang, status: sub.status === "unsubscribed" ? "active" : sub.status, updatedAt: new Date() })
    .where(eq(subscribers.id, sub.id));
  return Response.json({ message: sub.status === "unsubscribed" ? "已重新订阅，设置已保存" : "设置已保存，从下一封邮件开始生效" });
}
