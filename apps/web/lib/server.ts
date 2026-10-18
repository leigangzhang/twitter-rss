import "server-only";
import { randomBytes } from "node:crypto";
import { getConfig, type Lang, loadDotEnv } from "@xrss/core";
import { getDb, migrateDb } from "@xrss/core/db";
import { createSmtpMailer, type Mailer, smtpConfigFromEnv } from "@xrss/emails";

// 网站和命令行共用仓库根目录的 .env
loadDotEnv();

let ready: Promise<void> | undefined;

/** 首次访问时执行数据库迁移（本地开发方便；正式环境也可提前运行 pnpm db:migrate） */
export async function db() {
  const instance = getDb();
  ready ??= migrateDb(instance);
  await ready;
  return instance;
}

export function config() {
  return getConfig();
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function siteUrl(path = ""): string {
  return `${(process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

export const LANG_LABEL: Record<Lang, string> = { zh: "中文（AI 翻译）", orig: "原文" };

export interface TopicOption {
  id: string;
  name: string;
  color: string;
  accounts: string[];
}

export function topicOptions(): TopicOption[] {
  return config().topics.map((t) => ({ id: t.id, name: t.name, color: t.color, accounts: t.accounts }));
}

let mailer: Mailer | undefined;

export async function sendMail(mail: { to: string; subject: string; html: string; text: string }) {
  const smtp = smtpConfigFromEnv();
  if (!smtp) {
    // 本地没配 SMTP 时，把确认链接打印到终端，方便直接点开
    console.log(`[mail] 未配置 SMTP_USER/SMTP_PASS，未实际发送。收件人 ${mail.to}，标题「${mail.subject}」\n${mail.text}`);
    return;
  }
  mailer ??= createSmtpMailer(smtp, { intervalMs: 0 });
  await mailer.send(mail);
}
