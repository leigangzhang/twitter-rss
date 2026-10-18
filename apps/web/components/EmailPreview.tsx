"use client";

import { useState } from "react";
import snapshot from "@/data/preview.json";

type Lang = "zh" | "orig";

interface PreviewItem {
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
interface PreviewText {
  text: string;
  translatedFrom?: string;
  quoted?: { handle: string; text: string };
  article?: string;
}

/** 固定示例：由 pnpm preview:snapshot 从真实精选内容生成（apps/web/data/preview.json），按评分从高到低 */
const data = snapshot as { generatedAt: string; periodLabel: string; items: PreviewItem[] };

function Avatar({ author, color }: { author: PreviewItem["author"]; color: string }) {
  const [failed, setFailed] = useState(false);
  if (author.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={author.avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-7 shrink-0 rounded-full bg-[#E6E8EB] object-cover"
      />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: `${color}1F`, color }}>
      {author.initials}
    </span>
  );
}

function Item({ item, lang }: { item: PreviewItem; lang: Lang }) {
  const t = item[lang];
  return (
    <article className="flex flex-col gap-2 border-b border-line px-5 py-4">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: item.topic.color }} />
        <span className="truncate font-bold" style={{ color: item.topic.color }}>
          {item.topic.name}
        </span>
        {item.categoryLabel ? <span className="shrink-0 rounded-full bg-[#F1F2F4] px-2 py-px text-muted">{item.categoryLabel}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <Avatar author={item.author} color={item.topic.color} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-bold">{item.author.name}</span>
          <span className="truncate font-mono text-[10.5px] text-muted">
            @{item.author.handle} · {item.time}
            {lang === "zh" && t.translatedFrom ? ` · ${t.translatedFrom}` : ""}
          </span>
        </span>
      </div>
      <p className="m-0 line-clamp-4 text-[13px] leading-[1.75] whitespace-pre-line text-body">{t.text}</p>
      {t.quoted ? (
        <div className="rounded-lg border border-line bg-[#FAFBFC] px-3 py-2 text-[12px] leading-relaxed text-body">
          <span className="font-mono text-[10.5px] text-muted">@{t.quoted.handle}</span>
          <p className="m-0 line-clamp-2">{t.quoted.text}</p>
        </div>
      ) : null}
      {t.article ? <div className="truncate text-[12px] text-accent">🔗 {t.article}</div> : null}
      <div className="flex gap-3 font-mono text-[10.5px] text-muted">
        <span>♡ {item.likes}</span>
        <span>⇄ {item.reposts}</span>
        <span className="grow" />
        <span className="font-sans text-accent">{item.video ? "看视频 ↗" : "原推 ↗"}</span>
      </div>
    </article>
  );
}

/**
 * 订阅页右侧的邮件预览。高度跟随左侧"选择主题 + 阅读语言"（大屏时由外层网格决定），
 * 超出部分隐藏并淡出。
 */
export function EmailPreview({ lang }: { lang: Lang }) {
  const items = data.items;
  return (
    <aside className="flex min-w-0 flex-col gap-3.5 max-lg:h-[640px]" aria-label="邮件预览">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-base font-bold">
          <span className="mr-2 font-mono text-accent">→</span>邮件预览
        </div>
        <span className="text-[13px] text-muted">{lang === "zh" ? "中文版" : "原文版"} · 真实精选示例</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[14px] border border-line bg-white">
          <div className="flex shrink-0 flex-col gap-1 border-b border-line px-5 py-4">
            <div className="font-mono text-[11px] text-muted">精选晨报 · {data.periodLabel}</div>
            <div className="text-lg font-black">值得读的 {items.length} 条</div>
            <div className="text-[11px] text-muted">按 AI 评分从高到低</div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {items.map((item) => (
              <Item key={item.id} item={item} lang={lang} />
            ))}
          </div>
          {/* 底部淡出，提示下面还有内容 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[41px] h-20 bg-gradient-to-b from-white/0 to-white" />
          <div className="relative shrink-0 border-t border-line bg-[#F5F6F8] px-5 py-3 text-xs text-muted">
            共 {items.length} 条，下方内容已省略 · 真实邮件按你选的主题分区
          </div>
        </div>
      </div>
    </aside>
  );
}
