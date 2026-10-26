import type { AppConfig, DigestView } from "@xrss/core";
import { type AdminVote, adminVotes, type Db, FEEDBACK_REASONS, NOTE_MAX, REASON_LABELS, type Vote } from "@xrss/core/db";
import { renderDigest } from "@xrss/emails";
import { buildIssueEmail } from "./delivery.ts";

/** 后台预览里赞 / 踩提交到的接口（只有管理员能调用） */
export const ADMIN_FEEDBACK_PATH = "/api/admin/feedback";

/** 只保留真的会发出的条目，并给每条加上赞 / 踩链接（链接本身不会被打开，由页面脚本拦截后提交） */
export function withVoteLinks(view: DigestView, keep: Set<string>, date: string): DigestView {
  const link = (id: string, v: Vote) => `${ADMIN_FEEDBACK_PATH}?${new URLSearchParams({ t: id, d: date, v }).toString()}`;
  const groups = view.groups
    .map((g) => ({ ...g, items: g.items.filter((c) => keep.has(c.id)).map((c) => ({ ...c, feedback: { up: link(c.id, "up"), down: link(c.id, "down") } })) }))
    .filter((g) => g.items.length > 0);
  return { ...view, groups, total: groups.reduce((n, g) => n + g.items.length, 0) };
}

/**
 * 页面脚本：
 * - 点"赞 / 踩"立即提交，不跳转、不确认；选中的变色加粗，再点一次同一个取消；
 * - 踩了之后，这条下面出现原因（可不选）和一个说明框，选原因或保存说明时更新这条评价；
 * - 打开页面时按 __STATE__（已有的评价）上色、回填原因和说明。
 */
const VOTE_SCRIPT = `(() => {
  const state = __STATE__;
  const reasons = __REASONS__;
  const api = __API__;
  const on = { up: "#2F7D4F", down: "#A3271A" };
  const links = () => document.querySelectorAll("a[data-vote]");
  const parts = (a) => { const q = new URL(a.href, location.href).searchParams; return { t: q.get("t"), d: q.get("d"), v: a.dataset.vote }; };
  const dates = {};
  const save = async (t, body) => {
    const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tweetId: t, issueDate: dates[t], ...body }) });
    if (!res.ok) throw new Error(String(res.status));
  };
  const chip = (sel) => "display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:999px;font-size:12px;cursor:pointer;border:1px solid " + (sel ? on.down : "#D9DCE1") + ";background:" + (sel ? "#FBE9E7" : "#fff") + ";color:" + (sel ? on.down : "#4A5059");
  const picker = (t) => {
    const anchor = document.querySelector('a[data-vote="down"][href*="t=' + t + '&"]')?.closest("p");
    if (!anchor) return;
    let box = document.getElementById("xrss-reason-" + t);
    const s = state[t];
    if (!s || s.vote !== "down") { box?.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.id = "xrss-reason-" + t;
      box.style.cssText = "margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#F5F6F8;font-size:12px;color:#6A717B";
      anchor.after(box);
      const label = document.createElement("div");
      label.textContent = "为什么不想看（可不选）";
      label.style.marginBottom = "6px";
      const chips = document.createElement("div");
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center";
      const input = document.createElement("input");
      input.maxLength = __NOTE_MAX__;
      input.placeholder = "补充说明（可选）";
      input.style.cssText = "flex:1;min-width:0;padding:5px 8px;border:1px solid #D9DCE1;border-radius:8px;font-size:12px";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "保存";
      btn.style.cssText = chip(false) + ";margin:0";
      const status = document.createElement("span");
      row.append(input, btn, status);
      box.append(label, chips, row);
      for (const [id, text] of reasons) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.reason = id;
        b.textContent = text;
        b.addEventListener("click", async () => {
          const s = state[t];
          const before = s.reason;
          s.reason = before === id ? null : id;
          picker(t);
          try { await save(t, { vote: "down", reason: s.reason }); } catch (err) { s.reason = before; picker(t); alert("原因没有保存（" + err.message + "）"); }
        });
        chips.append(b);
      }
      const saveNote = async () => {
        const s = state[t];
        status.textContent = "保存中…";
        try { await save(t, { vote: "down", note: input.value }); s.note = input.value.trim() || null; status.textContent = "已保存"; }
        catch (err) { status.textContent = "没有保存（" + err.message + "）"; }
      };
      btn.addEventListener("click", saveNote);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveNote(); } });
      input.value = s.note ?? "";
    }
    box.querySelectorAll("button[data-reason]").forEach((b) => { b.style.cssText = chip(s.reason === b.dataset.reason); });
  };
  const paint = (t) => {
    links().forEach((a) => {
      const p = parts(a);
      if (p.t !== t) return;
      if (a.dataset.base === undefined) a.dataset.base = a.style.color;
      const sel = state[t]?.vote === p.v;
      a.style.color = sel ? on[p.v] : a.dataset.base;
      a.style.fontWeight = sel ? "700" : "";
    });
    picker(t);
  };
  links().forEach((a) => { const p = parts(a); dates[p.t] = p.d; a.removeAttribute("target"); a.title = "点一下记录，再点一次取消"; });
  Object.keys(dates).forEach(paint);
  document.addEventListener("click", async (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[data-vote]") : null;
    if (!a) return;
    e.preventDefault();
    const { t, v } = parts(a);
    const before = state[t] ?? null;
    const next = before?.vote === v ? null : v;
    if (next) state[t] = { vote: next, reason: null, note: null }; else delete state[t];
    document.getElementById("xrss-reason-" + t)?.remove();
    paint(t);
    try { await save(t, { vote: next }); }
    catch (err) {
      if (before) state[t] = before; else delete state[t];
      document.getElementById("xrss-reason-" + t)?.remove();
      paint(t);
      alert("没有记录上（" + err.message + "），请刷新后重试");
    }
  });
})();`;

/** 放进 <script> 的 JSON："<" 转义，避免提前结束标签 */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** 把脚本放进 HTML，带上已有的评价 */
export function injectVoteScript(html: string, state: Record<string, AdminVote>): string {
  const code = VOTE_SCRIPT.replace("__STATE__", json(state))
    .replace("__REASONS__", json(FEEDBACK_REASONS.map((r) => [r, REASON_LABELS[r]])))
    .replace("__API__", json(ADMIN_FEEDBACK_PATH))
    .replace("__NOTE_MAX__", String(NOTE_MAX));
  const script = `<script>${code}</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
}

/**
 * 后台预览：和 buildIssueEmail 看到的内容相同（先按真实邮件的篇幅挑出条目），
 * 再给每条加上赞 / 踩并重新渲染（不再限制大小，免得链接占的字节挤掉条目）。
 */
export async function buildAdminPreview(db: Db, config: AppConfig, date: string, subscriberId: number, mode: "latest" | "sent"): Promise<{ html: string } | { error: string }> {
  const built = await buildIssueEmail(db, config, date, subscriberId, mode);
  if ("error" in built) return { error: built.error };
  const view = withVoteLinks(built.view, new Set(built.tweetIds), date);
  const email = await renderDigest(view, { tabs: config.digest.mail.tabs });
  return { html: injectVoteScript(email.html, await adminVotes(db, built.tweetIds)) };
}
