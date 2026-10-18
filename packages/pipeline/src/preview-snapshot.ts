import { type AppConfig, type CardView, effectiveTopicId, findRepoRoot, localDate, monthDayLabel, qualityOf, toCardView } from "@xrss/core";
import { accounts, type Db, tweets, type TweetRow } from "@xrss/core/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 订阅页"邮件预览"用的固定示例：从真实精选内容里挑出来，保存后不再随每天的数据变化 */
export interface PreviewText {
  text: string;
  translatedFrom?: string;
  quoted?: { handle: string; text: string };
  article?: string;
}

export interface PreviewItem {
  id: string;
  url: string;
  topic: { id: string; name: string; color: string };
  author: { name: string; handle: string; avatarUrl?: string; initials: string };
  time: string;
  categoryLabel?: string;
  quality: number;
  likes: string;
  reposts: string;
  video: boolean;
  zh: PreviewText;
  orig: PreviewText;
}

export interface PreviewSnapshot {
  generatedAt: string;
  /** 内容日期范围的说明，如"10月17日" */
  periodLabel: string;
  items: PreviewItem[];
}

export const PREVIEW_PATH = () => join(findRepoRoot(), "apps", "web", "data", "preview.json");

function textOf(card: CardView): PreviewText {
  return {
    text: card.parts.join("\n\n"),
    translatedFrom: card.translatedFrom,
    quoted: card.quoted ? { handle: card.quoted.handle, text: card.quoted.text } : undefined,
    article: card.article?.title ?? card.quoted?.article?.title ?? card.link?.title,
  };
}

/** 发布时间：固定写成"10月17日 09:12"，模板不会因为日期变化变成"昨天" */
function absoluteTime(d: Date, tz: string): string {
  const hm = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${monthDayLabel(localDate(d, tz))} ${hm}`;
}

/**
 * 挑选最近 days 天里通过精选的推文（AI 判为保留的），按质量分从高到低、同分按综合分，取 count 条。
 * 只用经过当前精选标准评审的内容（有 verdict），不用早期规则分试跑的结果。
 */
export async function buildPreviewSnapshot(db: Db, config: AppConfig, opts: { count: number; days: number; now?: Date }): Promise<PreviewSnapshot> {
  const now = opts.now ?? new Date();
  const tz = config.digest.timezone;
  const rows = await db
    .select()
    .from(tweets)
    .where(and(eq(tweets.status, "scored"), gte(tweets.createdAt, new Date(now.getTime() - opts.days * 86_400_000))))
    .orderBy(desc(tweets.finalScore));
  const avatars = new Map((await db.select({ handle: accounts.handle, avatarUrl: accounts.avatarUrl }).from(accounts)).map((a) => [a.handle, a.avatarUrl]));

  const picked = rows
    .filter((r): r is TweetRow & { ai: NonNullable<TweetRow["ai"]> } => r.ai?.verdict === "keep")
    .sort((a, b) => qualityOf(b.ai) - qualityOf(a.ai) || (b.finalScore ?? 0) - (a.finalScore ?? 0))
    .slice(0, opts.count);

  const items = picked.map((r): PreviewItem => {
    const topicId = effectiveTopicId(config, r.topicId, r.handle) ?? config.topics[0]!.id;
    const topic = config.topics.find((t) => t.id === topicId)!;
    const view = (lang: "zh" | "orig") =>
      toCardView({ id: r.id, topicId, kind: r.kind, raw: r.raw, ai: r.ai }, { lang, timezone: tz, videoMode: "summary", maxThreadParts: 3, now });
    const zh = view("zh");
    return {
      id: r.id,
      url: zh.url,
      topic: { id: topic.id, name: topic.name, color: topic.color },
      author: { ...zh.author, avatarUrl: zh.author.avatarUrl ?? avatars.get(r.handle) ?? undefined },
      time: absoluteTime(r.createdAt, tz),
      categoryLabel: zh.categoryLabel,
      quality: qualityOf(r.ai),
      likes: zh.likes,
      reposts: zh.reposts,
      video: zh.kind === "video",
      zh: textOf(zh),
      orig: textOf(view("orig")),
    };
  });

  const days = [...new Set(picked.map((r) => localDate(r.createdAt, tz)))].sort();
  const periodLabel = days.length <= 1 ? monthDayLabel(days[0] ?? localDate(now, tz)) : `${monthDayLabel(days[0]!)}–${monthDayLabel(days.at(-1)!)}`;
  return { generatedAt: now.toISOString(), periodLabel, items };
}

export function writePreviewSnapshot(snapshot: PreviewSnapshot, path = PREVIEW_PATH()): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}
