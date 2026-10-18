"use client";

import { useState } from "react";

type Action = "manage" | "unsubscribe" | "lang";

const COPY: Record<Action, { title: string; desc: string; button: string }> = {
  manage: { title: "管理订阅", desc: "输入你订阅时用的邮箱，我们会把专属的设置链接发给你，用它修改主题、语言或退订。", button: "发送设置链接" },
  unsubscribe: { title: "退订精选晨报", desc: "输入你订阅时用的邮箱，我们会把退订链接发给你，点击即可退订。", button: "发送退订链接" },
  lang: { title: "切换阅读语言", desc: "输入你订阅时用的邮箱，我们会把切换语言的链接发给你。", button: "发送切换链接" },
};

export function ManageForm({ action, to }: { action: Action; to?: "zh" | "orig" }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string }>({ kind: "idle" });
  const copy = COPY[action];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "sending" });
    const res = await fetch("/api/manage-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, action, to }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    setState(res.ok ? { kind: "done", message: data.message } : { kind: "error", message: data.message ?? "提交失败，请稍后再试" });
  }

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 py-10">
      <div className="flex flex-col gap-5 rounded-[14px] border border-line bg-white p-8">
        <h1 className="m-0 text-2xl font-black">{copy.title}</h1>
        <p className="m-0 text-[15px] leading-relaxed text-body">{copy.desc}</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="manage-email" className="text-sm font-bold">
            邮箱
          </label>
          <div className="flex flex-wrap gap-2.5">
            <input
              id="manage-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="h-[52px] min-w-0 flex-[1_1_240px] rounded-[10px] border-[1.5px] border-[#D5D9DF] bg-white px-4 text-base text-ink outline-none focus:border-accent"
            />
            <button type="submit" disabled={state.kind === "sending"} className="h-[52px] cursor-pointer rounded-[10px] bg-ink px-6 text-base font-bold text-white disabled:opacity-60">
              {state.kind === "sending" ? "发送中…" : copy.button}
            </button>
          </div>
          <p role="status" className={`m-0 text-[13px] ${state.kind === "error" ? "text-danger" : state.kind === "done" ? "font-medium text-[#2F7D4F]" : "text-muted"}`}>
            {state.message ?? "为了防止别人改动你的订阅，设置只能通过发到你邮箱的链接进行。"}
          </p>
        </form>
      </div>
    </main>
  );
}
