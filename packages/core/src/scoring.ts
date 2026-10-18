import type { DigestConfig } from "./config.ts";
import type { MediaKind, RawTweet } from "./types.ts";

export function mediaKind(t: Pick<RawTweet, "media">): MediaKind {
  if (t.media.some((m) => m.type === "video" || m.type === "gif")) return "video";
  if (t.media.some((m) => m.type === "photo")) return "image";
  return "text";
}

/** 加权互动数：转发和引用比点赞更能说明内容被认可 */
export function engagement(t: Pick<RawTweet, "metrics">): number {
  const m = t.metrics;
  return m.likes + 2 * m.reposts + 3 * m.quotes + 0.5 * m.replies;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 规则分（0–1）：相对作者自己近期互动中位数的表现。
 * 用作者自身做基准，避免大号天然占优；达到中位数 4 倍时记满分。
 */
export function ruleScore(t: Pick<RawTweet, "metrics">, authorBaseline: number): number {
  const rel = engagement(t) / Math.max(authorBaseline, 1);
  return Math.min(1, Math.log1p(rel) / Math.log1p(4));
}

/** 正文总长度（含 Thread 后续部分），按字符计 */
export function textLength(t: Pick<RawTweet, "text" | "thread">): number {
  return [...t.text].length + t.thread.reduce((n, p) => n + [...p.text].length, 0);
}

export type FilterVerdict = { ok: true } | { ok: false; reason: string };

/** 规则粗筛：不需要 AI 就能排除的内容 */
export function passesFilters(t: RawTweet, cfg: DigestConfig["filters"]): FilterVerdict {
  if (t.isRepost && !cfg.include_reposts) return { ok: false, reason: "纯转发" };
  if (t.isReply && !cfg.include_replies) return { ok: false, reason: "回复" };
  const hasSubstance = t.media.length > 0 || t.quoted !== undefined || t.links.length > 0;
  const stripUrls = (s: string) => s.replace(/https?:\/\/\S+/g, "").trim();
  const length = textLength({ text: stripUrls(t.text), thread: t.thread.map((p) => ({ ...p, text: stripUrls(p.text) })) });
  if (!hasSubstance && length < cfg.min_text_length) {
    return { ok: false, reason: "正文过短" };
  }
  return { ok: true };
}

/** 最终分（0–1 × 媒体权重）：AI 质量分占 70%，互动表现占 30% */
export function finalScore(quality: number, rule: number, kind: MediaKind, weights: DigestConfig["media_weight"]): number {
  return (0.7 * (quality / 10) + 0.3 * rule) * weights[kind];
}

/**
 * X 计算推文长度的方式（twitter-text v3）：拉丁字母等记 1，中日韩文字和 emoji 记 2，链接固定记 23。
 * 普通推文上限 280；时间线里接近上限的推文很可能是被截断的长推文。
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, () => {
    n += 23;
    return "";
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

/** 长推文在时间线中被截断时，可见部分会贴近 280 的上限 */
export const TRUNCATION_THRESHOLD = 260;
