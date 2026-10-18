import "server-only";
import { randomBytes } from "node:crypto";
import { getConfig, type Lang } from "@xrss/core";
import { getDb, migrateDb } from "@xrss/core/db";
import { Resend } from "resend";

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

export async function sendMail(mail: { to: string; subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    // 本地没配邮件服务时，把确认链接打印到终端，方便直接点开
    console.log(`[mail] 未配置 RESEND_API_KEY/MAIL_FROM，未实际发送。收件人 ${mail.to}，标题「${mail.subject}」\n${mail.text}`);
    return;
  }
  const { error } = await new Resend(key).emails.send({ from, ...mail });
  if (error) throw new Error(error.message);
}
