"use client";

import { useState } from "react";
import type { TopicOption } from "@/lib/server";

export function RssList({ topics, site }: { topics: TopicOption[]; site: string }) {
  const [lang, setLang] = useState<"zh" | "orig">("zh");
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section id="rss" className="flex flex-col gap-3.5 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-bold">更习惯 RSS 阅读器？</h2>
        <div role="radiogroup" aria-label="RSS 语言" className="flex gap-1 rounded-lg border border-line bg-white p-1 text-[13px]">
          {(
            [
              ["zh", "中文"],
              ["orig", "原文"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={lang === v}
              onClick={() => setLang(v)}
              className={`min-h-8 cursor-pointer rounded-md px-3 ${lang === v ? "bg-ink text-white" : "text-body"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 text-sm text-muted">每个主题一个 Feed，内容与邮件相同。</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {topics.map((t) => {
          const url = `${site}/feed/${t.id}.${lang}.xml`;
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-white px-4 py-3">
              <span className="size-2 rounded-[2px]" style={{ background: t.color }} />
              <span className="w-[220px] max-w-full text-sm font-bold">{t.name}</span>
              <a href={url} className="min-w-0 flex-[1_1_240px] font-mono text-[13px] break-all text-body">
                {url}
              </a>
              <button type="button" onClick={() => copy(url)} className="min-h-8 cursor-pointer rounded-md px-2 text-[13px] text-accent">
                {copied === url ? "已复制" : "复制"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
