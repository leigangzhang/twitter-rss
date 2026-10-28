"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { ok: boolean; text: string } | null;

/** 调用账号管理接口，完成后刷新页面 */
function useAccountAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function run(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const res = await fetch("/api/admin/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    const ok = res.ok && data.ok !== false;
    setResult({ ok, text: data.message ?? (ok ? "已保存" : "保存失败") });
    setBusy(false);
    if (ok) router.refresh();
    return ok;
  }
  return { busy, result, run };
}

function Status({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <span role="status" className={`text-xs whitespace-pre-line ${result.ok ? "text-[#2F7D4F]" : "text-danger"}`}>
      {result.text}
    </span>
  );
}

const input = "min-h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink";
const button = "min-h-9 cursor-pointer rounded-lg px-3 text-[13px] font-bold whitespace-nowrap disabled:opacity-60";

/** 新增账号：账号（可以粘贴 @name 或主页链接）+ 主题 */
export function AddAccountForm({ topics }: { topics: Array<{ id: string; name: string }> }) {
  const { busy, result, run } = useAccountAction();
  const [handle, setHandle] = useState("");
  const [topicId, setTopicId] = useState(topics[0]?.id ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ action: "add", handle, topicId })) setHandle("");
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="X 账号"
          required
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@账号 或 x.com/账号"
          className={`${input} w-56`}
        />
        <select aria-label="主题" value={topicId} onChange={(e) => setTopicId(e.target.value)} className={input}>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className={`${button} bg-ink text-white`}>
          {busy ? "添加中…" : "添加账号"}
        </button>
      </div>
      <Status result={result} />
    </form>
  );
}

/** 移出账号：先点一次进入确认，再点才真正移出 */
export function RemoveAccountButton({ handle, topicId, label, confirmLabel }: { handle: string; topicId?: string; label: string; confirmLabel: string }) {
  const { busy, result, run } = useAccountAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {confirm ? (
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await run({ action: "remove", handle, topicId });
              setConfirm(false);
            }}
            className={`${button} bg-danger text-white`}
          >
            {busy ? "移出中…" : confirmLabel}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className={`${button} border border-line bg-white text-body`}>
            取消
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className={`${button} border border-line bg-white text-body hover:border-[#C9CED5]`}>
          {label}
        </button>
      )}
      <Status result={result?.ok ? null : result} />
    </span>
  );
}

/** 从某个主题移出（账号在多个主题里时，主题标签上的 ×） */
export function RemoveFromTopicButton({ handle, topicId, topicName }: { handle: string; topicId: string; topicName: string }) {
  const { busy, result, run } = useAccountAction();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={`只从「${topicName}」移出`}
        aria-label={`把 @${handle} 从「${topicName}」移出`}
        onClick={() => {
          if (window.confirm(`把 @${handle} 从「${topicName}」移出？它仍留在其他主题里。`)) void run({ action: "remove", handle, topicId });
        }}
        className="-mr-1 cursor-pointer px-1 text-muted hover:text-danger"
      >
        ×
      </button>
      {result && !result.ok ? <Status result={result} /> : null}
    </>
  );
}

/** 账号权重：点一下展开编辑，0–2，留空或 1 = 默认；原因写成 digest.yaml 里的行尾注释 */
export function WeightEditor({ handle, weight, note }: { handle: string; weight: number; note?: string }) {
  const { busy, result, run } = useAccountAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(weight === 1 ? "" : String(weight));
  const [reason, setReason] = useState(note ?? "");
  const today = new Date().toLocaleDateString("sv-SE");

  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={note ? `原因：${note}` : "点击调整权重"}
          className={`min-h-8 cursor-pointer rounded-md border px-2 font-mono text-xs ${weight === 1 ? "border-line bg-white text-muted" : "border-[#F0C987] bg-[#FDF1DE] font-bold text-[#8A5300]"}`}
        >
          ×{weight}
        </button>
        <Status result={result} />
      </span>
    );
  }
  return (
    <form
      className="flex w-56 flex-col gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        const w = value.trim() === "" ? null : Number(value);
        if (await run({ action: "weight", handle, weight: w, note: w === null ? "" : reason })) setOpen(false);
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          aria-label="权重"
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="1"
          className={`${input} w-20 font-mono`}
        />
        <button type="submit" disabled={busy} className={`${button} bg-ink text-white`}>
          保存
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${button} border border-line bg-white text-body`}>
          取消
        </button>
      </div>
      <input aria-label="原因" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`原因，如 ${today} 踩多`} className={`${input} w-full`} />
      <span className="text-[11px] text-muted">0–2，留空 = 默认 1；小于 1 排得更靠后</span>
      <Status result={result} />
    </form>
  );
}

/** 立即同步关注列表：在后台启动同步，几分钟后刷新看结果 */
export function SyncFollowsButton({ running }: { running: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={busy || running}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/admin/follows", { method: "POST" });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
          setResult({ ok: res.ok, text: data.message ?? (res.ok ? "已开始同步" : "启动失败") });
          setBusy(false);
          router.refresh();
        }}
        className={`${button} bg-ink text-white`}
      >
        {running ? "同步中…" : busy ? "启动中…" : "立即同步"}
      </button>
      <Status result={result} />
    </span>
  );
}
