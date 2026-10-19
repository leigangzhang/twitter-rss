import { render } from "@react-email/render";
import type { DigestView } from "@xrss/core";
import { createElement } from "react";
import { ConfirmEmail, type ConfirmEmailProps } from "./ConfirmEmail.tsx";
import { DailyDigest } from "./DailyDigest.tsx";
import { ManageLinkEmail, type ManageLinkEmailProps } from "./ManageLinkEmail.tsx";
import { PreferencesUpdatedEmail, type PreferencesUpdatedEmailProps } from "./PreferencesUpdatedEmail.tsx";

export { ConfirmEmail, DailyDigest, ManageLinkEmail, PreferencesUpdatedEmail };
export { TweetCard } from "./TweetCard.tsx";
export * from "./smtp.ts";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Gmail 会截断超过约 102KB 的邮件正文，超过阈值时在流水线里告警 */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export async function renderDigest(view: DigestView, opts: { tabs?: boolean; probe?: boolean } = {}): Promise<RenderedEmail> {
  const element = createElement(DailyDigest, { view, ...opts });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const first = view.groups[0]?.items[0];
  const lead = first ? `：${first.author.name} 等` : "";
  const when = view.periodLabel ?? view.date.slice(5).replace("-", "/");
  return { subject: `精选晨报 · ${when} ${view.total} 条${lead}`, html, text };
}

export async function renderConfirm(props: ConfirmEmailProps): Promise<RenderedEmail> {
  const element = createElement(ConfirmEmail, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: "确认订阅精选晨报", html, text };
}

export async function renderManageLink(props: ManageLinkEmailProps): Promise<RenderedEmail> {
  const element = createElement(ManageLinkEmail, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const subject = { manage: "你的订阅管理链接", unsubscribe: "确认退订精选晨报", lang: "切换精选晨报的阅读语言" }[props.action];
  return { subject, html, text };
}

export async function renderPreferencesUpdated(props: PreferencesUpdatedEmailProps): Promise<RenderedEmail> {
  const element = createElement(PreferencesUpdatedEmail, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: "精选晨报订阅设置已更新", html, text };
}
