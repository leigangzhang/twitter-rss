import { loadDotEnv } from "@xrss/core";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";

loadDotEnv();

/**
 * 给管理员（.env 的 ADMIN_EMAIL）发一封提醒，供 scripts/daily-auto.sh 在流水线跑不起来时使用（比如到点仍然连不上 X）：
 *   pnpm notify "标题" "正文"
 * 没设置 ADMIN_EMAIL 或 SMTP 时只打印，不报错。
 */
const [subject = "精选晨报提醒", text = ""] = process.argv.slice(2);
const admin = process.env.ADMIN_EMAIL?.trim();
const smtp = smtpConfigFromEnv();
if (!admin || !smtp) {
  console.warn(`未设置 ADMIN_EMAIL 或 SMTP，提醒没有发出：${subject}`);
  process.exit(0);
}
const mailer = createSmtpMailer(smtp, { intervalMs: 0 });
try {
  const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  await mailer.send({ to: admin, subject: `【精选晨报】${subject}`, text, html: `<pre style="font:14px/1.6 sans-serif;white-space:pre-wrap">${escaped}</pre>` });
  console.log(`已发提醒到 ${admin}`);
} catch (e) {
  console.warn(`提醒发送失败：${(e as Error).message}`);
} finally {
  mailer.close();
}
