import type { DigestConfig, Topic } from "./config.ts";
import { xWeightedLength } from "./scoring.ts";
import { compactNumber, displayTime, localDate } from "./time.ts";
import { type AiResult, CATEGORY_LABELS, type Lang, type Link, type LinkDigest, type MediaKind, type RawTweet } from "./types.ts";

/** 邮件卡片和 RSS 条目共用的展示数据，语言已确定，模板里不再判断 */
export interface CardView {
  id: string;
  url: string;
  topicId: string;
  author: { handle: string; name: string; avatarUrl?: string; initials: string };
  time: string;
  /** 中文版且原文不是中文时显示"译自英文" */
  translatedFrom?: string;
  /** 内容类型标签：最佳实践 / 真实问题 / 趋势解读 / 专家观点（未分类时为空） */
  categoryLabel?: string;
  /** 右上角标签：长文 / Thread · 3 / 视频 · 6:48 */
  badge?: string;
  kind: MediaKind;
  /** 正文；Thread 时为多段，模板按 1/N 编号 */
  parts: string[];
  /** Thread 超过上限时省略的条数 */
  moreParts: number;
  /** 正文没能拿到全文（时间线截断且未补抓详情），模板提示"全文较长，查看原推" */
  truncated: boolean;
  images: Array<{ url: string; width?: number; height?: number; alt?: string }>;
  video?: { thumbUrl?: string; duration?: string };
  /** AI 生成的中文说明（视频、含文字的图片） */
  mediaNote?: string;
  quoted?: { name: string; handle: string; text: string; url: string; article?: ArticleView };
  /** X 长文，或抓不到正文、也没有摘要的普通链接 */
  link?: { kind: "web" | "x_article"; url: string; title?: string; description?: string; domain?: string; imageUrl?: string };
  /** 推文自己附带的外部文章（图文摘要）；引用推文里的文章在 quoted.article */
  article?: ArticleView;
  likes: string;
  reposts: string;
  ctaLabel: string;
}

/** 外部文章的图文摘要卡片 */
export interface ArticleView {
  url: string;
  site?: string;
  /** 展示标题：中文版用中文标题，原文版用原标题 */
  title: string;
  /** 展示标题与原标题不同时显示原标题 */
  originalTitle?: string;
  /** AI 概要；没有时用网页简介 */
  summary?: string;
  /** 是否为 AI 生成的概要（否则是网页自带的简介） */
  aiSummary: boolean;
  points: string[];
  imageUrl?: string;
}

export interface TweetForView {
  id: string;
  topicId: string;
  kind: MediaKind;
  raw: RawTweet;
  ai: AiResult | null;
  /** 推文或引用推文里外部文章的抓取结果和摘要 */
  article?: LinkDigest;
}

/** 推文里要展示成文章卡片的那条链接：优先推文自己的外链，其次引用推文里的外链 */
export function primaryArticle(raw: RawTweet): { link: Link; source: "tweet" | "quoted" } | null {
  const own = raw.links.find((l) => l.kind === "web");
  if (own) return { link: own, source: "tweet" };
  const quoted = raw.quoted?.links.find((l) => l.kind === "web");
  if (quoted) return { link: quoted, source: "quoted" };
  return null;
}

function toArticleView(link: Link, d: LinkDigest | undefined, lang: Lang, zhTitle?: string | null, zhDesc?: string | null): ArticleView | undefined {
  const original = d?.title ?? link.title;
  const title = (lang === "zh" ? (d?.titleZh ?? zhTitle) : undefined) ?? original;
  if (!title) return undefined;
  const aiSummary = Boolean(d?.summary);
  return {
    url: d?.finalUrl ?? link.expandedUrl,
    site: d?.siteName ?? link.domain,
    title,
    originalTitle: original && original !== title ? original : undefined,
    summary: d?.summary ?? (lang === "zh" ? (zhDesc ?? undefined) : undefined) ?? d?.description ?? link.description,
    aiSummary,
    points: d?.points ?? [],
    imageUrl: d?.imageUrl ?? link.imageUrl,
  };
}

const LANG_NAMES: Record<string, string> = {
  en: "英文",
  ja: "日文",
  ko: "韩文",
  fr: "法文",
  de: "德文",
  es: "西班牙文",
  pt: "葡萄牙文",
  ru: "俄文",
  it: "意大利文",
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

function duration(sec?: number): string | undefined {
  if (sec === undefined) return undefined;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ViewOptions {
  lang: Lang;
  timezone: string;
  videoMode: DigestConfig["video_mode"];
  maxThreadParts: number;
  now?: Date;
}

export function toCardView(t: TweetForView, opts: ViewOptions): CardView {
  const raw = t.raw;
  const zh = opts.lang === "zh" ? t.ai?.zh ?? null : null;
  const isChinese = raw.lang?.startsWith("zh") ?? false;

  const allParts = [zh?.text ?? raw.text, ...raw.thread.map((p, i) => zh?.thread[i] ?? p.text)];
  const parts = allParts.slice(0, opts.maxThreadParts);

  const videoMedia = raw.media.find((m) => m.type === "video" || m.type === "gif");
  let badge: string | undefined;
  if (videoMedia) badge = `视频${videoMedia.durationSec ? ` · ${duration(videoMedia.durationSec)}` : ""}`;
  else if (raw.thread.length > 0) badge = `Thread · ${raw.thread.length + 1}`;
  else if (raw.textTruncated || xWeightedLength(raw.text) > 280) badge = "长文";

  const link = raw.links[0];
  const primary = primaryArticle(raw);
  const ownArticle = primary?.source === "tweet" ? toArticleView(primary.link, t.article, opts.lang, zh?.linkTitle, zh?.linkDescription) : undefined;
  return {
    id: raw.id,
    url: raw.url,
    topicId: t.topicId,
    author: {
      handle: raw.author.handle,
      name: raw.author.name,
      avatarUrl: raw.author.avatarUrl,
      initials: initials(raw.author.name),
    },
    time: displayTime(raw.createdAt, opts.timezone, opts.now),
    categoryLabel: t.ai?.category && t.ai.category !== "other" ? CATEGORY_LABELS[t.ai.category] : undefined,
    // 没有正文（如只有 X 长文链接）或语言未知时不标"译自"
    translatedFrom:
      zh && !isChinese && raw.text.trim() && !["zxx", "und", "qme", "qht", "qam"].includes(raw.lang ?? "")
        ? `译自${LANG_NAMES[raw.lang ?? ""] ?? "外文"}`
        : undefined,
    badge,
    kind: t.kind,
    parts,
    moreParts: allParts.length - parts.length,
    truncated: raw.textTruncated,
    images: raw.media.filter((m) => m.type === "photo").slice(0, 4).map((m) => ({ url: m.url, width: m.width, height: m.height, alt: m.altText })),
    video: videoMedia
      ? { thumbUrl: opts.videoMode === "thumbnail" ? videoMedia.url : undefined, duration: duration(videoMedia.durationSec) }
      : undefined,
    mediaNote: t.ai?.mediaNote ?? undefined,
    quoted: raw.quoted
      ? {
          name: raw.quoted.author.name,
          handle: raw.quoted.author.handle,
          text: zh?.quotedText ?? raw.quoted.text,
          url: raw.quoted.url,
          article: primary?.source === "quoted" ? toArticleView(primary.link, t.article, opts.lang, zh?.linkTitle, zh?.linkDescription) : undefined,
        }
      : undefined,
    article: ownArticle,
    link: link && !ownArticle
      ? {
          kind: link.kind,
          url: link.expandedUrl,
          title: zh?.linkTitle ?? link.title,
          description: zh?.linkDescription ?? link.description,
          domain: link.kind === "x_article" ? "X 长文" : link.domain,
          imageUrl: link.imageUrl,
        }
      : undefined,
    likes: compactNumber(raw.metrics.likes),
    reposts: compactNumber(raw.metrics.reposts),
    ctaLabel: videoMedia ? "看视频 ↗" : "原推 ↗",
  };
}

export interface DigestView {
  date: string;
  dateLabel: string;
  /** 内容覆盖的时间，例如"10月17日"；为空时表示最近 24 小时 */
  periodLabel?: string;
  lang: Lang;
  total: number;
  topicCount: number;
  accountCount: number;
  scannedCount: number;
  groups: Array<{ topic: Pick<Topic, "id" | "name" | "color">; items: CardView[] }>;
  links: { manage: string; switchLang: string; unsubscribe: string; rss: string };
  /**
   * true：链接是收件人专属的（单独发送）；false：合并发送的通用链接，
   * 点击后需要输入邮箱，系统再把专属链接发到该邮箱
   */
  personalLinks: boolean;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function dateLabel(date: Date, timeZone: string): string {
  const d = localDate(date, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return `${d.replaceAll("-", ".")} · ${WEEKDAYS[idx] ?? ""}`;
}

/** 2026-10-17 → 10月17日 */
export function monthDayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}
