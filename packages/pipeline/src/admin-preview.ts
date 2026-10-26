import type { AppConfig, DigestView } from "@xrss/core";
import { type AdminVote, adminVotes, type Db, FEEDBACK_REASONS, NOTE_MAX, REASON_LABELS, type Vote } from "@xrss/core/db";
import { renderDigest, renderDigestParts } from "@xrss/emails";
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

/** 赞 / 踩图标（设计稿给的 PNG，放在网站的 apps/web/public/icons/ 下，后台预览和网站同源） */
const ICON_URL = { up: "/icons/thumb-up.png", down: "/icons/thumb-down.png" };
/** PNG 本身是很浅的灰色，白底上看不清，所以当遮罩用，颜色由背景色决定 */
const ICON = { idle: "#9CA3AF", hover: "#6B7280", up: "#2F7D4F", down: "#A3271A" };

/**
 * 把文字"赞 · 踩"换成图标；选中（data-on）时赞变绿、踩变红。不支持遮罩的浏览器直接显示 PNG。
 * 图标 15px 画在 20px 的方块中间：方块和底部这一行的行高相同，图标和文字居中对齐，可点的范围也大一些。
 */
const mask = (url: string) => `-webkit-mask:url("${url}") center/15px no-repeat;mask:url("${url}") center/15px no-repeat`;
const VOTE_STYLE = `a[data-vote]{display:inline-block;width:20px;height:20px;vertical-align:top;font-size:0;background:center/15px no-repeat}
a[data-vote="up"]{margin-right:6px;background-image:url("${ICON_URL.up}");opacity:.9}
a[data-vote="down"]{background-image:url("${ICON_URL.down}");opacity:.9}
@supports ((mask-image:none) or (-webkit-mask-image:none)){
a[data-vote]{background-image:none;opacity:1;background-color:${ICON.idle}}
a[data-vote="up"]{${mask(ICON_URL.up)}}
a[data-vote="down"]{${mask(ICON_URL.down)}}
a[data-vote]:hover{background-color:${ICON.hover}}
a[data-vote="up"][data-on]{background-color:${ICON.up}}
a[data-vote="down"][data-on]{background-color:${ICON.down}}
}
[data-vote-sep]{display:none}
p:has(>a[data-vote]) a:not([data-vote]){white-space:nowrap}`;

/**
 * 页面脚本：
 * - 点赞 / 踩图标立即提交，不跳转、不确认；选中的变色，再点一次同一个取消；
 * - 踩了之后，这条下面出现原因（可不选）和一个说明框，选原因或保存说明时更新这条评价，随后自动收起成一行
 *   "原因：说明　修改"；点面板以外的地方或按 Esc 也会收起（没保存的说明顺手保存）；
 * - 打开页面时按 __STATE__（已有的评价）上色，已有的踩显示为收起的一行。
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
  const reasonText = Object.fromEntries(reasons);
  const summary = (s) => [s.reason ? reasonText[s.reason] : null, s.note].filter(Boolean).join("：");
  const anchorOf = (t) => document.querySelector('a[data-vote="down"][href*="t=' + t + '&"]')?.closest("p");
  /** 收起原因面板；说明框里改过但没保存的内容顺手保存 */
  const collapse = async (t) => {
    const s = state[t];
    if (!s?.open) return;
    const input = document.getElementById("xrss-reason-" + t)?.querySelector("input");
    const typed = input ? input.value.trim() : "";
    if (input && typed !== (s.note ?? "")) {
      try { await save(t, { vote: "down", note: typed }); s.note = typed || null; } catch {}
    }
    s.open = false;
    picker(t);
  };
  const collapseLater = (t) => setTimeout(() => collapse(t), 600);
  const picker = (t) => {
    const anchor = anchorOf(t);
    if (!anchor) return;
    let box = document.getElementById("xrss-reason-" + t);
    let sum = document.getElementById("xrss-sum-" + t);
    const s = state[t];
    if (!s || s.vote !== "down") { box?.remove(); sum?.remove(); return; }
    if (!s.open) {
      box?.remove();
      if (!sum) {
        sum = document.createElement("div");
        sum.id = "xrss-sum-" + t;
        sum.style.cssText = "margin:6px 0 0;font-size:12px;line-height:1.6;color:#6A717B";
        anchor.after(sum);
      }
      const text = summary(s);
      sum.textContent = text ? text + "　" : "";
      const edit = document.createElement("a");
      edit.href = "#";
      edit.textContent = text ? "修改" : "加原因";
      edit.style.cssText = "color:#6A717B;text-decoration:underline;cursor:pointer";
      edit.addEventListener("click", (e) => { e.preventDefault(); s.open = true; picker(t); });
      sum.append(edit);
      return;
    }
    sum?.remove();
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
          try {
            await save(t, { vote: "down", reason: s.reason });
            // 正在写说明时不收起，等保存或回车
            if (input.value.trim() === (s.note ?? "")) collapseLater(t);
          } catch (err) { s.reason = before; picker(t); alert("原因没有保存（" + err.message + "）"); }
        });
        chips.append(b);
      }
      const saveNote = async () => {
        const s = state[t];
        status.textContent = "保存中…";
        try { await save(t, { vote: "down", note: input.value }); s.note = input.value.trim() || null; status.textContent = "已保存"; collapseLater(t); }
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
      if (state[t]?.vote === p.v) a.dataset.on = ""; else delete a.dataset.on;
    });
    picker(t);
  };
  links().forEach((a) => { const p = parts(a); dates[p.t] = p.d; a.removeAttribute("target"); a.title = (p.v === "up" ? "赞" : "踩") + "：点一下记录，再点一次取消"; a.setAttribute("aria-label", p.v === "up" ? "赞" : "踩"); });
  Object.keys(dates).forEach(paint);
  // 点面板以外的地方或按 Esc 收起
  const openIds = () => Object.keys(state).filter((t) => state[t].open);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") openIds().forEach(collapse); });
  document.addEventListener("click", async (e) => {
    const el = e.target instanceof Element ? e.target : null;
    // 点"修改"时那一行已经换成面板，被点的元素已不在页面上，不算点在外面
    if (el?.isConnected) for (const t of openIds()) if (!document.getElementById("xrss-reason-" + t)?.contains(el)) collapse(t);
    const a = el ? el.closest("a[data-vote]") : null;
    if (!a) return;
    e.preventDefault();
    const { t, v } = parts(a);
    const before = state[t] ?? null;
    const next = before?.vote === v ? null : v;
    if (next) state[t] = { vote: next, reason: null, note: null, open: next === "down" }; else delete state[t];
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

/** 把样式和脚本放进 HTML，带上已有的评价 */
export function injectVoteScript(html: string, state: Record<string, AdminVote>): string {
  const code = VOTE_SCRIPT.replace("__STATE__", json(state))
    .replace("__REASONS__", json(FEEDBACK_REASONS.map((r) => [r, REASON_LABELS[r]])))
    .replace("__API__", json(ADMIN_FEEDBACK_PATH))
    .replace("__NOTE_MAX__", String(NOTE_MAX));
  const script = `<style>${VOTE_STYLE}</style><script>${code}</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
}

/** 预览顶部的说明：这一页是哪种内容、共几条 */
export function previewBanner(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<div style="position:sticky;top:0;z-index:10;padding:10px 16px;background:#FFF8E6;border-bottom:1px solid #F0DDB0;color:#6B4E00;font:13px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">${esc}</div>`;
}

const insertAfterBodyTag = (html: string, fragment: string) => {
  const m = /<body[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + fragment + html.slice(m.index + m[0].length) : fragment + html;
};

/**
 * 后台预览：把这一期给这位订阅者的全部内容放在一页里（不按邮件大小截断），每条带赞 / 踩。
 * - sent：当时实际发出的全部条目（分卷发送时是几封合起来）；
 * - latest：现在重新发送会发出的条目，按真实发送的规则分卷、去掉放不下的低分内容后合起来。
 */
export async function buildAdminPreview(db: Db, config: AppConfig, date: string, subscriberId: number, mode: "latest" | "sent"): Promise<{ html: string } | { error: string }> {
  const built = await buildIssueEmail(db, config, date, subscriberId, mode);
  if ("error" in built) return { error: built.error };
  const mailCfg = config.digest.mail;
  let keep: string[];
  let note: string;
  if (mode === "sent") {
    keep = built.view.groups.flatMap((g) => g.items.map((c) => c.id));
    note = `已发出的：${built.subscriber.email} 这一期收到的全部 ${keep.length} 条（分卷发送时是几封合起来）。点每条左下角的赞 / 踩记录反馈。`;
  } else {
    const parts = await renderDigestParts(built.view, { tabs: mailCfg.tabs, maxBytes: mailCfg.max_kb * 1024, maxParts: mailCfg.max_parts });
    keep = parts.flatMap((p) => p.tweetIds);
    const dropped = parts[0]?.dropped.length ?? 0;
    const split = parts.length > 1 ? `分 ${parts.length} 封发出（${parts.map((p) => p.tweetIds.length).join(" / ")} 条）` : "一封发出";
    note = `预览重发：现在重新发送会${split}，共 ${keep.length} 条${dropped ? `；因篇幅去掉 ${dropped} 条低分内容，不在下面` : ""}。点每条左下角的赞 / 踩记录反馈。`;
  }
  const view = withVoteLinks(built.view, new Set(keep), date);
  const email = await renderDigest(view, { tabs: mailCfg.tabs });
  return { html: injectVoteScript(insertAfterBodyTag(email.html, previewBanner(note)), await adminVotes(db, keep)) };
}
