import { subscribers } from "@xrss/core/db";
import { renderManageLink } from "@xrss/emails";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, sendMail, siteUrl } from "@/lib/server";

const Body = z.object({
  email: z.email("邮箱格式不正确").transform((e) => e.trim().toLowerCase()),
  action: z.enum(["manage", "unsubscribe", "lang"]).default("manage"),
  to: z.enum(["zh", "orig"]).optional(),
});

/** 同一邮箱 5 分钟内只发一次，避免被用来刷邮件 */
const recent = new Map<string, number>();
const COOLDOWN_MS = 5 * 60_000;

// 无论邮箱是否订阅过都返回同样的提示，避免被用来探测谁订阅了
const GENERIC = "如果这个邮箱订阅过精选晨报，专属链接已经发过去了，请查收（也看看垃圾邮件）。";

/**
 * 合并发送的邮件里没有个人链接：订阅者在 /manage 输入邮箱，
 * 这里把带专属 token 的管理 / 退订 / 切换语言链接发到该邮箱。
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "参数有误" }, { status: 400 });
  const { email, action, to } = parsed.data;

  const last = recent.get(email) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return Response.json({ message: GENERIC });
  recent.set(email, Date.now());

  const [sub] = await (await db()).select().from(subscribers).where(eq(subscribers.email, email));
  if (!sub) return Response.json({ message: GENERIC });

  const manageUrl = siteUrl(`/preferences/${sub.token}`);
  const target = action === "lang" ? (to ?? (sub.lang === "zh" ? "orig" : "zh")) : undefined;
  const actionUrl =
    action === "unsubscribe"
      ? siteUrl(`/unsubscribe/${sub.token}`)
      : action === "lang"
        ? siteUrl(`/api/preferences/${sub.token}/lang?to=${target}`)
        : manageUrl;

  const mail = await renderManageLink({ action, actionUrl, manageUrl, langLabel: target === "zh" ? "中文" : target === "orig" ? "原文" : undefined });
  try {
    await sendMail({ to: email, ...mail });
  } catch (e) {
    console.error("管理链接邮件发送失败", e);
    recent.delete(email);
    return Response.json({ message: "邮件发送失败，请稍后再试" }, { status: 502 });
  }
  return Response.json({ message: GENERIC });
}
