import { normalizeTopicIds } from "@xrss/core";
import { subscribers } from "@xrss/core/db";
import { renderConfirm, renderPreferencesUpdated } from "@xrss/emails";
import { eq } from "drizzle-orm";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
import { config, db, LANG_LABEL, newToken, sendMail, siteUrl } from "@/lib/server";
import { SubscribeBody } from "@/lib/validation";

/** 变更通知：同一邮箱 10 分钟内只发一封，避免反复提交被用来刷邮件（设置照常更新） */
const notified = new RateLimiter(1, 10 * 60_000);

/** 确认邮件：同一邮箱 10 分钟内只发一封；同一来源 1 小时最多发 10 封，避免被拿来给任意地址刷邮件 */
const confirmPerEmail = new RateLimiter(1, 10 * 60_000);
const confirmPerIp = new RateLimiter(10, 60 * 60_000);
/** 整个接口：同一来源 10 分钟最多提交 30 次 */
const requestsPerIp = new RateLimiter(30, 10 * 60_000);

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!requestsPerIp.take(ip)) return Response.json({ message: "提交太频繁，请稍后再试" }, { status: 429 });
  const parsed = SubscribeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ message: parsed.error.issues[0]?.message ?? "参数有误" }, { status: 400 });
  }
  const cfg = config();
  const { email, lang } = parsed.data;
  const topics = normalizeTopicIds(cfg, parsed.data.topics);
  if (topics.length === 0) return Response.json({ message: "至少选择一个主题" }, { status: 400 });
  const names = (ids: string[]) => cfg.topics.filter((t) => ids.includes(t.id)).map((t) => t.name);

  const d = await db();
  const [existing] = await d.select().from(subscribers).where(eq(subscribers.email, email));

  if (existing?.status === "active") {
    if (!cfg.digest.subscribe_page.overwrite_existing) {
      return Response.json({ message: "这个邮箱已经订阅了，可以通过任意一封邮件底部的链接管理设置。" });
    }
    // 已订阅：订阅页提交即直接覆盖主题和语言，不用再走管理链接
    const before = normalizeTopicIds(cfg, existing.topics);
    if (sameSet(before, topics) && existing.lang === lang) {
      return Response.json({ status: "unchanged", message: "这个邮箱已经是这些设置了，不用改动。" });
    }
    await d.update(subscribers).set({ topics, lang, updatedAt: new Date() }).where(eq(subscribers.id, existing.id));

    // 通知邮箱本人，防止被他人代改而不知情
    if (notified.take(email)) {
      try {
        const mail = await renderPreferencesUpdated({
          topicNames: names(topics),
          langLabel: LANG_LABEL[lang],
          previous: { topicNames: names(before), langLabel: LANG_LABEL[existing.lang] },
          manageUrl: siteUrl(`/preferences/${existing.token}`),
          unsubscribeUrl: siteUrl(`/unsubscribe/${existing.token}`),
        });
        await sendMail({ to: email, ...mail });
      } catch (e) {
        // 通知失败不影响本次修改
        console.error("变更通知邮件发送失败", e);
      }
    }
    return Response.json({
      status: "updated",
      message: `已更新：${names(topics).join("、")} · ${lang === "zh" ? "中文" : "原文"}，从下一封邮件开始生效。`,
    });
  }

  // 新邮箱或已退订 / 未确认：先发确认邮件，确认后才开始发送。
  // 刚发过就不再发，也不换 token，免得上一封邮件里的确认链接失效
  if (confirmPerEmail.blocked(email)) {
    return Response.json({ status: "pending", message: `确认邮件刚刚发到 ${email}，请查收（也看看垃圾邮件），10 分钟后可以重新发送。` });
  }
  if (!confirmPerIp.take(ip)) return Response.json({ message: "发送的确认邮件太多，请 1 小时后再试" }, { status: 429 });
  confirmPerEmail.hit(email);
  const token = newToken();
  if (existing) {
    await d.update(subscribers).set({ topics, lang, token, status: "pending", updatedAt: new Date() }).where(eq(subscribers.id, existing.id));
  } else {
    await d.insert(subscribers).values({ email, topics, lang, token, status: "pending" });
  }

  const mail = await renderConfirm({ confirmUrl: siteUrl(`/confirm/${token}`), topicNames: names(topics), langLabel: LANG_LABEL[lang] });
  try {
    await sendMail({ to: email, ...mail });
  } catch (e) {
    console.error("确认邮件发送失败", e);
    confirmPerEmail.reset(email);
    return Response.json({ message: "确认邮件发送失败，请稍后再试" }, { status: 502 });
  }
  return Response.json({ status: "pending", message: `确认邮件已发送到 ${email}，点击邮件里的按钮即可完成订阅。` });
}
