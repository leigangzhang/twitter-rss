"use client";

import { useState } from "react";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    setBusy(false);
    if (res.ok) return window.location.reload();
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    setMessage(data.message ?? "登录失败");
  }

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-col gap-6 py-10">
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-8">
        <h1 className="m-0 text-2xl font-black">订阅者管理</h1>
        <label htmlFor="admin-password" className="text-sm font-bold">
          管理密码
        </label>
        <input
          id="admin-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 rounded-[10px] border-[1.5px] border-[#D5D9DF] bg-white px-4 text-base outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy} className="h-12 cursor-pointer rounded-[10px] bg-ink text-base font-bold text-white disabled:opacity-60">
          {busy ? "登录中…" : "登录"}
        </button>
        <p role="status" className={`m-0 text-[13px] ${message ? "text-danger" : "text-muted"}`}>
          {message ?? "密码是 .env 里的 ADMIN_PASSWORD"}
        </p>
      </form>
    </main>
  );
}
