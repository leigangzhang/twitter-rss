"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";

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

/** 添加账号：右上角按钮，点开在弹窗里填 */
export function AddAccountDialog({ topics }: { topics: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${button} bg-ink text-white`}>
        ＋ 添加账号
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="添加账号" sub="写进 config/topics.yaml，下次生成采集清单时开始采集。已在名单里的账号只会加到选的主题；账号不存在时采集会跳过并提醒。">
        <AddAccountForm topics={topics} />
      </Dialog>
    </>
  );
}

/* ---------- 同步我的关注 ---------- */

export interface SyncLast {
  at: string;
  ok: boolean;
  message: string;
  added: string[];
  dryRun?: boolean;
  step?: string;
}
export interface SyncProgressView {
  step: string;
  read?: number;
  dryRun: boolean;
  startedAt: string;
}
interface SyncStatus {
  last: SyncLast | null;
  progress: SyncProgressView | null;
  log: string[];
}

const OPEN_SYNC = "xrss:open-sync";
const openSync = () => window.dispatchEvent(new Event(OPEN_SYNC));

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** 右上角的"同步我的关注"按钮 */
export function SyncFollowsButton() {
  return (
    <button type="button" onClick={openSync} className={`${button} border border-line bg-white text-body hover:border-[#C9CED5]`}>
      ⟳ 同步我的关注
    </button>
  );
}

/** 指标卡：最近一次同步的结果，点开弹窗 */
export function SyncFollowsCard({ last, running }: { last: SyncLast | null; running: boolean }) {
  const failed = last && !last.ok && !running;
  const status = running ? (
    <span className="rounded-full bg-[#EEF3FC] px-2 py-px font-bold text-[#1F4FA8]">进行中</span>
  ) : !last ? null : last.ok ? (
    <span className="rounded-full bg-[#E7F3EC] px-2 py-px font-bold text-[#22663D]">{last.dryRun ? "试运行" : "成功"}</span>
  ) : (
    <span className="rounded-full bg-[#FBE9E7] px-2 py-px font-bold text-[#A3271A]">失败</span>
  );
  const headline = running ? "正在同步" : !last ? "还没有同步过" : last.ok ? (last.added.length ? `${last.dryRun ? "会" : ""}新增 ${last.added.length} 个账号` : "没有新账号") : "同步失败";
  return (
    <button
      type="button"
      onClick={openSync}
      className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-[14px] border bg-white px-4 py-3.5 text-left hover:border-[#C9CED5] ${failed ? "border-danger" : "border-line"}`}
    >
      <span className="flex justify-between gap-2 text-xs text-muted">
        同步我的关注
        {status}
      </span>
      <span className={`text-lg leading-tight font-bold ${failed ? "text-danger" : ""}`}>{headline}</span>
      <span className="line-clamp-2 text-xs text-muted">{running ? "点开看进度" : last ? `${fmtTime(last.at)} · ${failed ? "点开看原因" : "点开看详情"}` : "点开开始同步"}</span>
    </button>
  );
}

/**
 * 同步弹窗：最近结果（失败时显示原因和日志最后几行）、进行中的步骤、自动同步设置、已取关的账号；
 * 可以先试运行（只列出会新增哪些账号，不改文件）。运行中每 2 秒取一次状态，结束后刷新页面。
 */
export function SyncFollowsDialog({
  steps,
  auto,
  unfollowed,
  initial,
}: {
  steps: Array<{ id: string; label: string }>;
  auto: string;
  unfollowed: string[];
  initial: SyncStatus;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(initial);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/follows", { cache: "no-store" });
    if (res.ok) setStatus((await res.json()) as SyncStatus);
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      void refresh();
    };
    window.addEventListener(OPEN_SYNC, onOpen);
    return () => window.removeEventListener(OPEN_SYNC, onOpen);
  }, [refresh]);

  // 运行中轮询；从运行中变成结束时刷新页面（卡片、账号列表）
  const running = Boolean(status.progress) || starting;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh().then(() => setStarting(false)), 2000);
    return () => clearInterval(t);
  }, [running, refresh]);
  const [wasRunning, setWasRunning] = useState(running);
  useEffect(() => {
    if (wasRunning && !running) router.refresh();
    setWasRunning(running);
  }, [running, wasRunning, router]);

  async function start(dryRun: boolean) {
    setError(null);
    setStarting(true);
    const res = await fetch("/api/admin/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      setStarting(false);
      setError(data.message ?? "启动失败");
      return;
    }
    // 给同步进程一点时间写下第一步
    setTimeout(() => void refresh(), 800);
  }

  const { last, progress, log } = status;
  const current = progress ? steps.findIndex((s) => s.id === progress.step) : -1;
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="同步我的关注"
      sub="读取采集 Chrome 里登录账号的「正在关注」，把名单里还没有的账号加进同步主题。只滚动读取，遇到限流就停止并冷却。"
      footer={
        running ? (
          <button type="button" onClick={() => setOpen(false)} className={`${button} border border-line bg-white text-body`}>
            在后台继续
          </button>
        ) : (
          <>
            <button type="button" onClick={() => start(true)} className={`${button} border border-line bg-white text-body`}>
              先试运行
            </button>
            <button type="button" onClick={() => start(false)} className={`${button} bg-ink text-white`}>
              立即同步
            </button>
          </>
        )
      }
    >
      {error ? <p className="m-0 rounded-[10px] bg-[#FBE9E7] px-3.5 py-2.5 text-[13px] text-danger">{error}</p> : null}
      {running ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
          {steps.map((s, i) => {
            const done = i < current;
            const now = i === current || (current < 0 && i === 0);
            return (
              <li key={s.id} className={`flex items-center gap-2.5 ${done || now ? "text-ink" : "text-muted"}`}>
                <span
                  className={`flex size-[18px] items-center justify-center rounded-full border text-[11px] ${done ? "border-[#2F7D4F] bg-[#2F7D4F] text-white" : now ? "animate-spin border-2 border-accent border-r-transparent" : "border-[#C9CED5]"}`}
                >
                  {done ? "✓" : ""}
                </span>
                {s.label}
                {now && progress?.read !== undefined ? <span className="font-mono text-muted">已读 {progress.read} 个</span> : null}
                {s.id === "write" && progress?.dryRun ? <span className="text-muted">（试运行，不改文件）</span> : null}
              </li>
            );
          })}
        </ol>
      ) : last ? (
        <div className={`flex flex-col gap-1.5 rounded-[10px] border px-3.5 py-3 text-[13px] ${last.ok ? "border-line bg-note text-body" : "border-danger bg-[#FBE9E7] text-danger"}`}>
          <b>
            {fmtTime(last.at)} {last.dryRun ? "试运行" : "同步"}
            {last.ok ? "完成" : "失败"}
          </b>
          <span className="whitespace-pre-line">{last.message.replace(/；/g, "\n")}</span>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">还没有同步过。第一次建议先点「先试运行」，看会新增哪些账号。</p>
      )}
      {!running && last && !last.ok && log.length ? (
        <details className="rounded-[10px] border border-line">
          <summary className="cursor-pointer px-3.5 py-2.5 text-[13px]">
            <b>日志</b> <span className="text-xs text-muted">data/logs/follow-sync.log 最后 {log.length} 行</span>
          </summary>
          <pre className="m-0 max-h-48 overflow-auto rounded-b-[10px] bg-note px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-body">{log.join("\n")}</pre>
        </details>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">自动同步</span>
        <span className="text-[13px]">{auto}</span>
      </div>
      {unfollowed.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted">已经取关、但还在名单里（移出后不会再同步回来）· {unfollowed.length}</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {unfollowed.map((h) => (
              <li key={h} className="flex items-center justify-between gap-2 border-t border-line py-2 text-[13px] first:border-t-0">
                <span className="font-mono">@{h}</span>
                <RemoveAccountButton handle={h} label="移出" confirmLabel="确认移出" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/** 按主题筛选：下拉框，改了就跳到对应链接 */
export function TopicFilter({ topics, value, hrefs }: { topics: Array<{ id: string; name: string }>; value?: string; hrefs: Record<string, string> }) {
  const router = useRouter();
  return (
    <select aria-label="按主题筛选" value={value ?? ""} onChange={(e) => router.push(hrefs[e.target.value] ?? hrefs[""]!)} className={`${input} rounded-full`}>
      <option value="">所有主题</option>
      {topics.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
