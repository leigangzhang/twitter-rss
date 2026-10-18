import { subscribers } from "@xrss/core/db";
import { renderConfirm } from "@xrss/emails";
import { eq } from "drizzle-orm";
import { config, db, LANG_LABEL, newToken, sendMail, siteUrl } from "@/lib/server";
import { SubscribeBody } from "@/lib/validation";

export async function POST(req: Request) {
  const parsed = SubscribeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: parsed.error.issues[0]?.message ?? "参数有误" }, { status: 400 });
  }
  const { email, lang } = parsed.data;
  const known = new Set(config().topics.map((t) => t.id));
  const topics = parsed.data.topics.filter((t) => known.has(t));
  if (topics.length === 0) return Response.json({ message: "至少选择一个主题" }, { status: 400 });

  const d = await db();
  const [existing] = await d.select().from(subscribers).where(eq(subscribers.email, email));
  if (existing?.status === "active") {
    // 不通过公开表单修改已订阅用户的设置，避免他人代改
    return Response.json({ message: "这个邮箱已经订阅了，可以通过任意一封邮件底部的链接管理设置。" });
  }

  const token = newToken();
  if (existing) {
    await d.update(subscribers).set({ topics, lang, token, status: "pending", updatedAt: new Date() }).where(eq(subscribers.id, existing.id));
  } else {
    await d.insert(subscribers).values({ email, topics, lang, token, status: "pending" });
  }

  const topicNames = config()
    .topics.filter((t) => topics.includes(t.id))
    .map((t) => t.name);
  const mail = await renderConfirm({ confirmUrl: siteUrl(`/confirm/${token}`), topicNames, langLabel: LANG_LABEL[lang] });
  try {
    await sendMail({ to: email, ...mail });
  } catch (e) {
    console.error("确认邮件发送失败", e);
    return Response.json({ message: "确认邮件发送失败，请稍后再试" }, { status: 502 });
  }
  return Response.json({ message: `确认邮件已发送到 ${email}，点击邮件里的按钮即可完成订阅。` });
}
