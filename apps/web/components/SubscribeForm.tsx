"use client";

import { useState } from "react";
import type { TopicOption } from "@/lib/server";

type Lang = "zh" | "orig";

interface Props {
  topics: TopicOption[];
  defaultLang: Lang;
  /** 管理偏好时传入：邮箱不可改，提交走 PUT */
  manage?: { token: string; email: string; topics: string[]; lang: Lang };
}

const PREVIEW = {
  zh: "超过约 3.2 万 token 后，检索效果更取决于信息在提示中的位置，而不是模型大小。关键指令请放在末尾，而不是开头。",
  orig: "Past ~32k tokens, retrieval quality depends far more on where the fact sits in the prompt than on model size. Put your key instructions at the end, not the start.",
};

function StepLabel({ n, children, htmlFor }: { n: string; children: React.ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? "label" : "div";
  return (
    <Tag htmlFor={htmlFor} className="text-base font-bold">
      <span className="mr-2 font-mono text-accent">{n}</span>
      {children}
    </Tag>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return on ? (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-accent">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  ) : (
    <span className="mt-0.5 size-5 shrink-0 rounded-[5px] border-[1.5px] border-[#B9BEC5]" />
  );
}

const optionClass = (on: boolean) =>
  `flex min-h-11 cursor-pointer gap-3 rounded-xl border-[1.5px] p-4 text-left transition-colors ${
    on ? "border-accent bg-accent-soft" : "border-line bg-white hover:border-[#C9CED5]"
  }`;

export function SubscribeForm({ topics, defaultLang, manage }: Props) {
  const [selected, setSelected] = useState<string[]>(manage?.topics ?? topics.slice(0, 2).map((t) => t.id));
  const [lang, setLang] = useState<Lang>(manage?.lang ?? defaultLang);
  const [email, setEmail] = useState(manage?.email ?? "");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string }>({ kind: "idle" });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const total = selected.length === 0 ? 0 : Math.min(10, 4 + selected.length * 2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return setState({ kind: "error", message: "至少选择一个主题" });
    setState({ kind: "sending" });
    const res = await fetch(manage ? `/api/preferences/${manage.token}` : "/api/subscribe", {
      method: manage ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, topics: selected, lang }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    setState(res.ok ? { kind: "done", message: data.message } : { kind: "error", message: data.message ?? "提交失败，请稍后再试" });
  }

  return (
    <div className="flex flex-wrap items-start gap-12">
      <form onSubmit={submit} className="flex min-w-0 flex-[999_1_540px] flex-col gap-9">
        {manage ? (
          <div className="flex flex-col gap-3">
            <h1 className="m-0 text-4xl font-black leading-tight tracking-tight">管理订阅</h1>
            <p className="m-0 text-base text-muted">{manage.email}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <h1 className="m-0 text-[clamp(32px,5vw,44px)] font-black leading-[1.25] tracking-tight">
              每天一封邮件，
              <br />
              读完你关心的 X
            </h1>
            <p className="m-0 text-[17px] leading-relaxed text-muted">从你选的主题里，每天早上 7 点精选 8–10 条推文。完整内容直接在邮件里读，不用打开 X。</p>
          </div>
        )}

        <fieldset className="flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <legend className="contents">
              <StepLabel n="01">选择主题</StepLabel>
            </legend>
            <span className="text-[13px] text-muted">已选 {selected.length} 个</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {topics.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(t.id)} className={optionClass(on)}>
                  <CheckBox on={on} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-[2px]" style={{ background: t.color }} />
                      <span className="text-[15px] font-bold text-ink">{t.name}</span>
                      <span className="font-mono text-xs text-muted">{t.accounts.length} 位博主</span>
                    </span>
                    <span className="truncate font-mono text-xs leading-relaxed text-muted">
                      {t.accounts
                        .slice(0, 3)
                        .map((a) => `@${a}`)
                        .join(" ")}
                      {t.accounts.length > 3 ? " …" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3.5">
          <legend className="mb-3.5">
            <StepLabel n="02">阅读语言</StepLabel>
          </legend>
          <div role="radiogroup" aria-label="阅读语言" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ["zh", "中文", "非中文推文由 AI 翻译成中文，只显示译文"],
                ["orig", "原文", "保留推文的原始语言，不做翻译"],
              ] as const
            ).map(([value, label, desc]) => (
              <button key={value} type="button" role="radio" aria-checked={lang === value} onClick={() => setLang(value)} className={`${optionClass(lang === value)} flex-col gap-1.5`}>
                <span className="text-[15px] font-bold text-ink">{label}</span>
                <span className="text-[13px] leading-relaxed text-muted">{desc}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3.5">
          {manage ? null : (
            <>
              <StepLabel n="03" htmlFor="email">
                你的邮箱
              </StepLabel>
              <div className="flex flex-wrap gap-2.5">
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="h-[52px] min-w-0 flex-[1_1_260px] rounded-[10px] border-[1.5px] border-[#D5D9DF] bg-white px-4 text-base text-ink outline-none focus:border-accent"
                />
                <button type="submit" disabled={state.kind === "sending"} className="h-[52px] cursor-pointer rounded-[10px] bg-ink px-7 text-base font-bold text-white disabled:opacity-60">
                  {state.kind === "sending" ? "提交中…" : "订阅"}
                </button>
              </div>
            </>
          )}
          {manage ? (
            <button type="submit" disabled={state.kind === "sending"} className="h-[52px] w-fit cursor-pointer rounded-[10px] bg-ink px-7 text-base font-bold text-white disabled:opacity-60">
              {state.kind === "sending" ? "保存中…" : "保存设置"}
            </button>
          ) : null}
          <p role="status" className={`m-0 text-[13px] ${state.kind === "error" ? "text-danger" : state.kind === "done" ? "font-medium text-[#2F7D4F]" : "text-muted"}`}>
            {state.message ?? (manage ? "修改从下一封邮件开始生效" : "我们会先发一封确认邮件 · 主题和语言随时可改 · 一键退订")}
          </p>
        </div>
      </form>

      <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-3" aria-label="邮件预览">
        <div className="text-[13px] font-bold tracking-[2px] text-muted">邮件预览</div>
        <div className="overflow-hidden rounded-[14px] border border-line bg-white">
          <div className="flex flex-col gap-1.5 border-b border-line px-[22px] py-5">
            <div className="font-mono text-[11px] text-muted">精选晨报 · 示例</div>
            <div className="text-xl font-black">今天值得读的 {total} 条</div>
          </div>
          <div className="flex flex-col gap-3 px-[22px] py-5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-[2px] bg-accent" />
              <span className="text-xs font-bold tracking-[1.5px] text-accent">AI 与大模型</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#DCE6F9] text-xs font-bold text-accent">MC</span>
              <span className="flex flex-col">
                <span className="text-sm font-bold">Mira Chen</span>
                <span className="font-mono text-[11px] text-muted">@mirachen_ml · 09:12{lang === "zh" ? " · 译自英文" : ""}</span>
              </span>
            </div>
            <p className="m-0 text-sm leading-[1.8] text-body">{PREVIEW[lang]}</p>
            <div className="flex gap-3.5 font-mono text-[11px] text-muted">
              <span>♡ 2.3万</span>
              <span>⇄ 3,104</span>
              <span className="grow" />
              <span className="font-sans text-accent">原推 ↗</span>
            </div>
          </div>
          <div className="border-t border-line bg-[#F5F6F8] px-[22px] py-3.5 text-xs text-muted">
            {total > 1 ? `另有 ${total - 1} 条，按你选的主题分区排列` : "选择主题后预览内容数量"}
          </div>
        </div>
      </aside>
    </div>
  );
}
