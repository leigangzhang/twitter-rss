"use client";

import { useState } from "react";
import { EmailPreview } from "@/components/EmailPreview";
import type { TopicAccount, TopicOption } from "@/lib/server";

type Lang = "zh" | "orig";

interface Props {
  topics: TopicOption[];
  defaultLang: Lang;
  /** 每个主题最多显示几个头像，超出显示 +N（digest.yaml 的 subscribe_page.max_avatars） */
  maxAvatars?: number;
  /** 管理偏好时传入：邮箱不可改，提交走 PUT */
  manage?: { token: string; email: string; topics: string[]; lang: Lang };
}

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

/** 头像：采集过的用 X 头像，没有或加载失败时显示首字母 */
function Avatar({ account, color }: { account: TopicAccount; color: string }) {
  const [failed, setFailed] = useState(false);
  const label = account.name ? `${account.name} @${account.handle}` : `@${account.handle}`;
  const ring = "size-8 shrink-0 rounded-full ring-2 ring-white";
  if (account.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.avatarUrl}
        alt={label}
        title={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${ring} bg-[#E6E8EB] object-cover`}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`${ring} flex items-center justify-center text-[11px] font-bold`}
      style={{ background: `${color}1F`, color }}
    >
      {account.handle.replace(/^_+/, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** 主题下的博主：头像从左到右叠放，超过 max 个只显示剩余人数；下面列出对应的 ID */
function AccountStack({ accounts, color, max }: { accounts: TopicAccount[]; color: string; max: number }) {
  const shown = accounts.slice(0, max);
  const rest = accounts.length - shown.length;
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center pl-1.5">
        {shown.map((a) => (
          <span key={a.handle} className="-ml-1.5">
            <Avatar account={a} color={color} />
          </span>
        ))}
        {rest > 0 ? (
          <span
            className="-ml-1.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-[#EEF0F2] px-2 font-mono text-[11px] font-bold text-body ring-2 ring-white"
            title={`另有 ${rest} 位博主`}
          >
            +{rest}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-1 font-mono text-xs leading-relaxed text-muted">
        {shown.map((a) => `@${a.handle}`).join(" ")}
        {rest > 0 ? ` 等 ${accounts.length} 位` : ""}
      </span>
    </span>
  );
}

const optionClass = (on: boolean) =>
  `flex min-h-11 cursor-pointer gap-3 rounded-xl border-[1.5px] p-4 text-left transition-colors ${
    on ? "border-accent bg-accent-soft" : "border-line bg-white hover:border-[#C9CED5]"
  }`;

export function SubscribeForm({ topics, defaultLang, maxAvatars = 7, manage }: Props) {
  // 新订阅默认不选主题，由用户自己勾选；管理订阅时显示已选的主题
  const [selected, setSelected] = useState<string[]>(manage?.topics ?? []);
  const [lang, setLang] = useState<Lang>(manage?.lang ?? defaultLang);
  const [email, setEmail] = useState(manage?.email ?? "");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string }>({ kind: "idle" });

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = selected.length === topics.length;
  const toggleAll = () => setSelected(allOn ? [] : topics.map((t) => t.id));

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
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-9">
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
            读完你关心的 X<span className="ml-2 align-middle text-[0.45em] font-bold tracking-normal text-muted">（原 Twitter）</span>
          </h1>
          <p className="m-0 text-[17px] leading-relaxed text-muted">
            从你选的主题里，每天早上 7 点精选 8–10 条推文。完整内容直接在邮件里读，不用打开 X（原 Twitter）。
          </p>
        </div>
      )}

      {/* 左：选择主题 + 阅读语言；右：邮件预览，上沿与"选择主题"对齐，下沿与"阅读语言"对齐 */}
      <div className="grid gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="flex min-w-0 flex-col gap-9">
          <fieldset className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <legend className="contents">
                <StepLabel n="01">选择主题</StepLabel>
              </legend>
              <span className="flex items-baseline gap-3 text-[13px] text-muted">
                已选 {selected.length} / {topics.length}
                <button type="button" onClick={toggleAll} className="cursor-pointer font-medium text-accent">
                  {allOn ? "清空" : "全选"}
                </button>
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {topics.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(t.id)} className={optionClass(on)}>
                    <CheckBox on={on} />
                    <span className="flex min-w-0 flex-1 flex-col gap-2.5">
                      <span className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: t.color }} />
                          <span className="text-[15px] font-bold text-ink">{t.name}</span>
                          <span className="font-mono text-xs text-muted">{t.accounts.length} 位博主</span>
                        </span>
                        {t.description ? <span className="text-[13px] leading-relaxed text-muted">{t.description}</span> : null}
                      </span>
                      <AccountStack accounts={t.accounts} color={t.color} max={maxAvatars} />
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
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={lang === value}
                  onClick={() => setLang(value)}
                  className={`${optionClass(lang === value)} flex-col gap-1.5`}
                >
                  <span className="text-[15px] font-bold text-ink">{label}</span>
                  <span className="text-[13px] leading-relaxed text-muted">{desc}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <EmailPreview lang={lang} />
      </div>

      <div className="flex flex-col gap-3.5 lg:max-w-[calc(100%-448px)]">
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
              <button
                type="submit"
                disabled={state.kind === "sending"}
                className="h-[52px] cursor-pointer rounded-[10px] bg-ink px-7 text-base font-bold text-white disabled:opacity-60"
              >
                {state.kind === "sending" ? "提交中…" : "订阅"}
              </button>
            </div>
          </>
        )}
        {manage ? (
          <button
            type="submit"
            disabled={state.kind === "sending"}
            className="h-[52px] w-fit cursor-pointer rounded-[10px] bg-ink px-7 text-base font-bold text-white disabled:opacity-60"
          >
            {state.kind === "sending" ? "保存中…" : "保存设置"}
          </button>
        ) : null}
        <p
          role="status"
          className={`m-0 text-[13px] ${state.kind === "error" ? "text-danger" : state.kind === "done" ? "font-medium text-[#2F7D4F]" : "text-muted"}`}
        >
          {state.message ?? (manage ? "修改从下一封邮件开始生效" : "新邮箱会先收到一封确认邮件 · 已订阅的邮箱重新提交即直接更新主题和语言 · 一键退订")}
        </p>
      </div>
    </form>
  );
}
