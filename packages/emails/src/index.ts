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

export interface DigestRenderOptions {
  /** 主题标签页（不支持的邮箱自动退回为依次排列） */
  tabs?: boolean;
  /** 测试邮件：顶部显示这个邮箱是否支持标签页 */
  probe?: boolean;
  /**
   * 邮件 HTML 的大小上限（字节）。超过时从条目最多的主题末尾（分数最低）开始，
   * 把完整卡片改成一句话摘要，直到放得下，避免 Gmail 折叠末尾。
   */
  maxBytes?: number;
}

async function renderOnce(view: DigestView, opts: DigestRenderOptions): Promise<RenderedEmail> {
  const element = createElement(DailyDigest, { view, tabs: opts.tabs, probe: opts.probe });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const first = view.groups[0]?.items[0];
  const lead = first ? `：${first.author.name} 等` : "";
  const when = view.periodLabel ?? view.date.slice(5).replace("-", "/");
  return { subject: `精选晨报 · ${when} ${view.total} 条${lead}`, html, text };
}

export async function renderDigest(view: DigestView, opts: DigestRenderOptions = {}): Promise<RenderedEmail & { compacted: number }> {
  let current = view;
  let email = await renderOnce(current, opts);
  let compacted = 0;
  while (opts.maxBytes && Buffer.byteLength(email.html) > opts.maxBytes) {
    // 每个主题至少保留一条完整卡片
    const candidates = current.groups.filter((g) => g.items.length > 1);
    if (candidates.length === 0) break;
    const fullest = candidates.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    // 一次挪动的条数按超出的比例估算，减少重复渲染
    const over = Buffer.byteLength(email.html) - opts.maxBytes;
    const step = Math.max(1, Math.min(fullest.items.length - 1, Math.ceil(over / 3500)));
    current = {
      ...current,
      groups: current.groups.map((g) =>
        g === fullest ? { ...g, items: g.items.slice(0, -step), compact: [...g.items.slice(-step), ...(g.compact ?? [])] } : g,
      ),
    };
    compacted += step;
    email = await renderOnce(current, opts);
  }
  return { ...email, compacted };
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
