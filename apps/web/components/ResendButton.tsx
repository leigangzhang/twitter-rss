"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 重新推送按钮：先点一次进入确认，再点才真正发送，避免误发 */
export function ResendButton({
  date,
  action,
  subscriberId,
  label,
  confirmLabel,
  previewHref,
  variant = "secondary",
}: {
  date: string;
  action: "resend" | "retry" | "missing";
  subscriberId?: number;
  label: string;
  confirmLabel: string;
  /** 确认这一步旁边放一个"先预览"，在新标签打开将要发出的内容 */
  previewHref?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirm" | "sending">("idle");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setStage("sending");
    const res = await fetch("/api/admin/deliveries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, action, subscriberId }) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    setMessage({ ok: res.ok && data.ok !== false, text: data.message ?? (res.ok ? "已完成" : "发送失败") });
    setStage("idle");
    router.refresh();
  }

  const base = "min-h-9 cursor-pointer rounded-lg px-3 text-[13px] font-bold whitespace-nowrap disabled:opacity-60";
  const style = variant === "primary" ? "bg-ink text-white" : "border border-line bg-white text-body hover:border-[#C9CED5]";
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      {stage === "confirm" ? (
        <span className="inline-flex gap-1.5">
          <button type="button" onClick={send} className={`${base} bg-danger text-white`}>
            {confirmLabel}
          </button>
          {previewHref ? (
            <a href={previewHref} target="_blank" rel="noreferrer" className={`${base} flex items-center border border-line bg-white text-body no-underline`}>
              先预览 ↗
            </a>
          ) : null}
          <button type="button" onClick={() => setStage("idle")} className={`${base} border border-line bg-white text-body`}>
            取消
          </button>
        </span>
      ) : (
        <button type="button" disabled={stage === "sending"} onClick={() => setStage("confirm")} className={`${base} ${style}`}>
          {stage === "sending" ? "发送中…" : label}
        </button>
      )}
      {message ? (
        <span role="status" className={`text-xs ${message.ok ? "text-[#2F7D4F]" : "text-danger"}`}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
