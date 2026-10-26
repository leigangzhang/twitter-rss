import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, loadConfig, loadDotEnv, localDate, runRange } from "@xrss/core";
import { createDb, migrateDb, subscribers } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { GMAIL_CLIP_BYTES, renderDigest, renderDigestParts } from "@xrss/emails";
import { buildView, feedbackLinker, loadDigestContext, sharedLinks, siteLinks } from "./digest.ts";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";

loadDotEnv();

/**
 * 发一封"主题标签页"测试邮件，看各个邮箱的显示效果（邮件顶部会显示这个邮箱是否支持标签页）：
 *   pnpm email:test                                 用今天这一期的全部内容生成，写到 data/out/<日期>/tabs-test.html
 *   pnpm email:test --to a@qq.com,b@163.com         同时发到这些邮箱
 *   pnpm email:test --date 2026-10-19 --max 30 --lang orig
 *   pnpm email:test --to a@qq.com --feedback        带 👍 / 👎 反馈链接（不管 mail.feedback 是否开启）；
 *                                                   收件人必须是订阅者，用他自己的专属链接，点了会真的记录反馈
 */
const { values } = parseArgs({
  options: { date: { type: "string" }, to: { type: "string" }, max: { type: "string" }, lang: { type: "string", default: "zh" }, feedback: { type: "boolean", default: false } },
});
const config = loadConfig();
values.max ??= String(config.digest.digest.total_items);
const date = values.date ?? localDate(new Date(), config.digest.timezone);
const lang = values.lang === "orig" ? "orig" : "zh";
const db = createDb();
await migrateDb(db);

const ctx = await loadDigestContext(db, { ...config }, date, runRange(config, date), new Date());
const wide = { ...config, digest: { ...config.digest, digest: { ...config.digest.digest, total_items: Number(values.max) } } };
const view = buildView({ ...ctx, config: wide }, config.topics.map((t) => t.id), lang, sharedLinks(lang), false);
if (!view) {
  console.error(`${date} 这一期没有可发的内容`);
  process.exit(1);
}
const email = await renderDigest(view, { tabs: true, probe: true, maxBytes: config.digest.mail.max_kb * 1024 });
const bytes = Buffer.byteLength(email.html);
const dir = join(findRepoRoot(), "data", "out", date);
mkdirSync(dir, { recursive: true });
const path = join(dir, "tabs-test.html");
writeFileSync(path, email.html);
console.log(`${view.total} 条（完整卡片 ${view.total - email.compacted}，一句话摘要 ${email.compacted}），${view.groups.length} 个主题，邮件 ${(bytes / 1024).toFixed(1)}KB${bytes > GMAIL_CLIP_BYTES ? "（超过 102KB，Gmail 会折叠末尾）" : ""}`);
const parts = await renderDigestParts(view, { tabs: true, maxBytes: config.digest.mail.max_kb * 1024, maxParts: config.digest.mail.max_parts });
if (parts.length > 1) {
  parts.forEach((p, i) => {
    const partPath = join(dir, `tabs-test-${i + 1}of${parts.length}.html`);
    writeFileSync(partPath, p.html);
    console.log(`实际按分卷发送：第 ${i + 1}/${parts.length} 封 ${p.tweetIds.length} 条（一句话摘要 ${p.compacted}），${(Buffer.byteLength(p.html) / 1024).toFixed(1)}KB → ${partPath}`);
  });
}
console.log(`已写入 ${path}`);

if (values.to) {
  const smtp = smtpConfigFromEnv();
  if (!smtp) {
    console.error("缺少 SMTP_USER 或 SMTP_PASS，无法发送");
    process.exit(1);
  }
  const mailer = createSmtpMailer(smtp, { intervalMs: config.digest.mail.send_interval_ms });
  for (const to of values.to.split(/[,，\s]+/).filter(Boolean)) {
    try {
      let message = email;
      if (values.feedback) {
        // 反馈链接要能对应到人：用这位订阅者的 token 重新生成一封
        const [sub] = await db.select().from(subscribers).where(eq(subscribers.email, to.toLowerCase()));
        if (!sub) {
          console.log(`  ✗ ${to}：不是订阅者，--feedback 需要用订阅者的专属链接`);
          continue;
        }
        const own = buildView({ ...ctx, config: wide }, config.topics.map((t) => t.id), lang, siteLinks(sub.token, lang), true, feedbackLinker(config, date, { token: sub.token }, true));
        message = await renderDigest(own!, { tabs: true, probe: true, maxBytes: config.digest.mail.max_kb * 1024 });
      }
      await mailer.send({ to, subject: `[测试] ${values.feedback ? "反馈链接" : "主题标签页"} · ${view.total} 条`, html: message.html, text: message.text });
      console.log(`  ✓ ${to}`);
    } catch (e) {
      console.log(`  ✗ ${to}：${(e as Error).message}`);
    }
  }
  mailer.close();
}
