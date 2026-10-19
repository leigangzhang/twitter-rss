import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findRepoRoot, loadConfig, loadDotEnv, localDate, runRange } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { GMAIL_CLIP_BYTES, renderDigest } from "@xrss/emails";
import { buildView, loadDigestContext, sharedLinks } from "./digest.ts";
import { createSmtpMailer, smtpConfigFromEnv } from "./mailer.ts";

loadDotEnv();

/**
 * 发一封"主题标签页"测试邮件，看各个邮箱的显示效果（邮件顶部会显示这个邮箱是否支持标签页）：
 *   pnpm email:test                                 用今天这一期的全部内容生成，写到 data/out/<日期>/tabs-test.html
 *   pnpm email:test --to a@qq.com,b@163.com         同时发到这些邮箱
 *   pnpm email:test --date 2026-10-19 --max 30 --lang orig
 */
const { values } = parseArgs({ options: { date: { type: "string" }, to: { type: "string" }, max: { type: "string" }, lang: { type: "string", default: "zh" } } });
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
      await mailer.send({ to, subject: `[测试] 主题标签页 · ${view.total} 条`, html: email.html, text: email.text });
      console.log(`  ✓ ${to}`);
    } catch (e) {
      console.log(`  ✗ ${to}：${(e as Error).message}`);
    }
  }
  mailer.close();
}
