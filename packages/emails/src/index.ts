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
  const count = view.part ? `${view.part.overall} 条（${view.part.index}/${view.part.count}）` : `${view.total} 条`;
  return { subject: `精选晨报 · ${when} ${count}${lead}`, html, text };
}

export async function renderDigest(view: DigestView, opts: DigestRenderOptions = {}): Promise<RenderedEmail & { compacted: number }> {
  let current = view;
  let email = await renderOnce(current, opts);
  let compacted = 0;
  let savedPerItem = 2000;
  while (opts.maxBytes && Buffer.byteLength(email.html) > opts.maxBytes) {
    // 每个主题至少保留一条完整卡片
    const candidates = current.groups.filter((g) => g.items.length > 1);
    if (candidates.length === 0) break;
    const fullest = candidates.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    // 一次挪动的条数按超出的字节数和"每挪一条省下多少"估算，减少重复渲染；省下的字节数按上一次的实测更新，避免挪过头
    const over = Buffer.byteLength(email.html) - opts.maxBytes;
    const step = Math.max(1, Math.min(fullest.items.length - 1, Math.ceil(over / savedPerItem)));
    const before = Buffer.byteLength(email.html);
    current = {
      ...current,
      groups: current.groups.map((g) =>
        g === fullest ? { ...g, items: g.items.slice(0, -step), compact: [...g.items.slice(-step), ...(g.compact ?? [])] } : g,
      ),
    };
    compacted += step;
    email = await renderOnce(current, opts);
    const saved = (before - Buffer.byteLength(email.html)) / step;
    if (saved > 0) savedPerItem = saved;
  }
  return { ...email, compacted };
}

export interface DigestPart extends RenderedEmail {
  /** 这一封里的推文（含一句话摘要） */
  tweetIds: string[];
  compacted: number;
}

/** 只保留扁平序号在 [start, end) 之间的条目，主题顺序不变 */
function sliceView(view: DigestView, start: number, end: number, part?: DigestView["part"]): DigestView {
  let offset = 0;
  const groups = view.groups
    .map((g) => {
      const from = offset;
      offset += g.items.length;
      return { ...g, items: g.items.slice(Math.max(0, start - from), Math.max(0, end - from)), compact: undefined };
    })
    .filter((g) => g.items.length > 0);
  return { ...view, groups, total: groups.reduce((n, g) => n + g.items.length, 0), part };
}

/**
 * 内容放不进一封时分卷发送：按顺序把条目切成几封，每封都是完整卡片且不超过 maxBytes，
 * 标题注明"（1/3）"。超过 maxParts 封时，最后一封里放不下的部分才改为一句话摘要。
 * 每封的条数用二分查找确定（每封约 6 次渲染）。
 */
export async function renderDigestParts(view: DigestView, opts: DigestRenderOptions & { maxParts?: number } = {}): Promise<DigestPart[]> {
  const ids = (v: DigestView) => v.groups.flatMap((g) => [...g.items, ...(g.compact ?? [])].map((i) => i.id));
  const whole = await renderOnce(view, opts);
  const maxParts = Math.max(1, opts.maxParts ?? 1);
  if (!opts.maxBytes || Buffer.byteLength(whole.html) <= opts.maxBytes || maxParts === 1) {
    const email = await renderDigest(view, opts);
    return [{ ...email, tweetIds: ids(view) }];
  }

  const n = view.total;
  // 估算时先用占位的封数，最后统一改成实际封数
  const fits = async (start: number, end: number, index: number) =>
    Buffer.byteLength((await renderOnce(sliceView(view, start, end, { index, count: maxParts, overall: n }), opts)).html) <= opts.maxBytes!;
  const bounds: Array<[number, number]> = [];
  let start = 0;
  while (start < n) {
    const index = bounds.length + 1;
    if (index === maxParts) {
      bounds.push([start, n]);
      break;
    }
    // 至少放一条；[lo, hi] 里找能放下的最大 end
    let lo = start + 1;
    let hi = n;
    if (await fits(start, hi, index)) lo = hi;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (await fits(start, mid, index)) lo = mid;
      else hi = mid - 1;
    }
    bounds.push([start, lo]);
    start = lo;
  }

  const parts: DigestPart[] = [];
  for (const [i, [s, e]] of bounds.entries()) {
    const partView = sliceView(view, s, e, { index: i + 1, count: bounds.length, overall: n });
    const email = await renderDigest(partView, opts);
    parts.push({ ...email, tweetIds: ids(partView) });
  }
  return parts;
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
