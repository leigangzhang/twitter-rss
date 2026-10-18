import { render } from "@react-email/render";
import type { DigestView } from "@xrss/core";
import { createElement } from "react";
import { ConfirmEmail, type ConfirmEmailProps } from "./ConfirmEmail.tsx";
import { DailyDigest } from "./DailyDigest.tsx";

export { ConfirmEmail, DailyDigest };
export { TweetCard } from "./TweetCard.tsx";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Gmail 会截断超过约 102KB 的邮件正文，超过阈值时在流水线里告警 */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export async function renderDigest(view: DigestView): Promise<RenderedEmail> {
  const element = createElement(DailyDigest, { view });
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
