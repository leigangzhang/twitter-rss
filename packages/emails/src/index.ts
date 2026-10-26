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
   * 邮件 HTML 的大小上限（字节），避免 Gmail 折叠末尾。放不下时先分卷（最多 maxParts 封），
   * 仍放不下就去掉分数最低的条目；邮件里只有完整卡片，不压成摘要。
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

const ids = (v: DigestView) => v.groups.flatMap((g) => g.items.map((i) => i.id));

/**
 * 去掉分数最低的 k 条（同分时去掉主题内靠后的）。每个主题尽量留至少一条，
 * 只有其他主题都只剩一条时才去掉某个主题的最后一条；整期至少留一条。
 */
export function dropLowest(view: DigestView, k: number): { view: DigestView; dropped: string[] } {
  const entries = view.groups.flatMap((g, gi) => g.items.map((card, i) => ({ card, gi, i })));
  const want = Math.min(k, entries.length - 1);
  const order = [...entries].sort((a, b) => (a.card.score ?? 0) - (b.card.score ?? 0) || b.i - a.i);
  const left = view.groups.map((g) => g.items.length);
  const drop = new Set<string>();
  for (const keepOnePerTopic of [true, false]) {
    for (const e of order) {
      if (drop.size >= want) break;
      if (drop.has(e.card.id) || (keepOnePerTopic && left[e.gi]! <= 1)) continue;
      drop.add(e.card.id);
      left[e.gi]!--;
    }
  }
  const groups = view.groups.map((g) => ({ ...g, items: g.items.filter((c) => !drop.has(c.id)) })).filter((g) => g.items.length > 0);
  return { view: { ...view, groups, total: groups.reduce((n, g) => n + g.items.length, 0) }, dropped: [...drop] };
}

/** 一封放下：超过 maxBytes 时去掉分数最低的条目，直到放得下 */
async function fitOne(view: DigestView, opts: DigestRenderOptions): Promise<{ email: RenderedEmail; view: DigestView; dropped: string[] }> {
  let current = view;
  let email = await renderOnce(current, opts);
  const dropped: string[] = [];
  // 第一次按整封的平均每条大小估算（含页头页尾，偏大，不会去过头），之后按实测的"每去一条省下多少"
  let savedPerItem = Buffer.byteLength(email.html) / Math.max(1, current.total);
  while (opts.maxBytes && Buffer.byteLength(email.html) > opts.maxBytes && current.total > 1) {
    // 一次去掉的条数按超出的字节数和"每去一条省下多少"估算，减少重复渲染
    const before = Buffer.byteLength(email.html);
    const step = Math.max(1, Math.min(current.total - 1, Math.ceil((before - opts.maxBytes) / savedPerItem)));
    const r = dropLowest(current, step);
    current = r.view;
    dropped.push(...r.dropped);
    email = await renderOnce(current, opts);
    const saved = (before - Buffer.byteLength(email.html)) / Math.max(1, r.dropped.length);
    if (saved > 0) savedPerItem = saved;
  }
  return { email, view: current, dropped };
}

export async function renderDigest(view: DigestView, opts: DigestRenderOptions = {}): Promise<RenderedEmail & { tweetIds: string[]; dropped: string[] }> {
  const { email, view: kept, dropped } = await fitOne(view, opts);
  return { ...email, tweetIds: ids(kept), dropped };
}

export interface DigestPart extends RenderedEmail {
  /** 这一封里的推文 */
  tweetIds: string[];
  /** 这一期因篇幅去掉的低分推文（每一封里都相同） */
  dropped: string[];
}

/** 只保留扁平序号在 [start, end) 之间的条目，主题顺序不变 */
function sliceView(view: DigestView, start: number, end: number, part?: DigestView["part"]): DigestView {
  let offset = 0;
  const groups = view.groups
    .map((g) => {
      const from = offset;
      offset += g.items.length;
      return { ...g, items: g.items.slice(Math.max(0, start - from), Math.max(0, end - from)) };
    })
    .filter((g) => g.items.length > 0);
  return { ...view, groups, total: groups.reduce((n, g) => n + g.items.length, 0), part };
}

/** 按顺序把条目切成最多 maxParts 封，每封尽量多放；返回切分和最后还剩多少条放不下 */
async function split(view: DigestView, maxParts: number, opts: DigestRenderOptions): Promise<{ bounds: Array<[number, number]>; leftover: number }> {
  const n = view.total;
  // 估算时先用占位的封数，最后统一改成实际封数
  const fits = async (start: number, end: number, index: number) =>
    Buffer.byteLength((await renderOnce(sliceView(view, start, end, { index, count: maxParts, overall: n }), opts)).html) <= opts.maxBytes!;
  const bounds: Array<[number, number]> = [];
  let start = 0;
  while (start < n && bounds.length < maxParts) {
    const index = bounds.length + 1;
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
  return { bounds, leftover: n - start };
}

/**
 * 内容放不进一封时分卷发送：按顺序把条目切成几封，每封都是完整卡片且不超过 maxBytes，标题注明"（1/3）"。
 * maxParts 封仍放不下时，去掉分数最低的条目（每个主题尽量留一条）再重新切分。每封的条数用二分查找确定。
 */
export async function renderDigestParts(view: DigestView, opts: DigestRenderOptions & { maxParts?: number } = {}): Promise<DigestPart[]> {
  const maxParts = Math.max(1, opts.maxParts ?? 1);
  const whole = await renderOnce(view, opts);
  if (!opts.maxBytes || Buffer.byteLength(whole.html) <= opts.maxBytes) return [{ ...whole, tweetIds: ids(view), dropped: [] }];
  if (maxParts === 1) {
    const email = await renderDigest(view, opts);
    return [email];
  }

  let current = view;
  const dropped: string[] = [];
  let plan = await split(current, maxParts, opts);
  while (plan.leftover > 0 && current.total > 1) {
    const r = dropLowest(current, plan.leftover);
    current = r.view;
    dropped.push(...r.dropped);
    plan = await split(current, maxParts, opts);
  }

  const parts: DigestPart[] = [];
  for (const [i, [s, e]] of plan.bounds.entries()) {
    const partView = sliceView(current, s, e, { index: i + 1, count: plan.bounds.length, overall: current.total });
    const email = await renderOnce(partView, opts);
    parts.push({ ...email, tweetIds: ids(partView), dropped });
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
