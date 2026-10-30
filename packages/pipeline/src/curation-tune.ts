import { CATEGORY_LABELS, qualityOf } from "@xrss/core";
import { type FeedbackInfo, REASON_LABELS } from "@xrss/core/db";
import type { CurationTuneResult } from "./ai.ts";

/**
 * 每天评审前，把上次以来后台的赞 / 踩交给大模型，对 config/curation.md 做几处小改动。
 * 这里是不调用模型的部分：整理反馈、检查并应用改动、写变更记录。命令行入口见 cli-curation-tune.ts。
 */

/** 一次最多采纳的改动处数 */
export const MAX_EDITS = 3;
/** 每处改动最多新增的字数 */
export const MAX_EDIT_GROWTH = 400;
/** 每处改动最多删掉原文的比例（防止"改写"变成删规则） */
const MAX_EDIT_SHRINK = 0.3;
/** 原文截取长度，控制提示词长度 */
const TEXT_MAX = 600;

/** 给模型看的反馈：编号从 1 开始，why 里用编号指代 */
export function feedbackPayload(list: FeedbackInfo[], topicName: (id: string) => string) {
  return list.map((f, i) => ({
    no: i + 1,
    vote: f.vote === "up" ? "赞" : "踩",
    reason: f.reason ? REASON_LABELS[f.reason] : undefined,
    note: f.note ?? undefined,
    account: f.handle ? `@${f.handle}` : undefined,
    topic: f.topicId ? topicName(f.topicId) : undefined,
    category: f.ai?.category ? CATEGORY_LABELS[f.ai.category] : undefined,
    quality: f.ai ? qualityOf(f.ai) : undefined,
    aiReason: f.ai?.reason,
    text: f.text.replace(/\s+/g, " ").slice(0, TEXT_MAX),
  }));
}

export type CurationEdit = CurationTuneResult["edits"][number];

export interface ApplyResult {
  text: string;
  applied: CurationEdit[];
  rejected: Array<{ edit: CurationEdit; problem: string }>;
}

const headings = (s: string) => s.split("\n").filter((l) => /^#{1,6}\s/.test(l.trim()));
const codes = (s: string) => [...s.matchAll(/\b[a-z]+(?:_[a-z]+)*(?=｜)/g)].map((m) => m[0]);

/** 逐处检查并应用改动；不合格的跳过并说明原因，不影响其他改动 */
export function applyCurationEdits(guide: string, edits: CurationEdit[]): ApplyResult {
  let text = guide;
  const applied: CurationEdit[] = [];
  const rejected: ApplyResult["rejected"] = [];
  for (const edit of edits) {
    const problem = checkEdit(text, edit, applied.length);
    if (problem) {
      rejected.push({ edit, problem });
      continue;
    }
    text = text.replace(edit.old, () => edit.new);
    applied.push(edit);
  }
  return { text, applied, rejected };
}

function checkEdit(text: string, { old, new: next }: CurationEdit, appliedCount: number): string | null {
  if (appliedCount >= MAX_EDITS) return `超过每次最多 ${MAX_EDITS} 处的限制`;
  if (!old.trim()) return "没有指明要改哪一段";
  const first = text.indexOf(old);
  if (first < 0) return "要改的原文在标准里找不到";
  if (text.indexOf(old, first + 1) >= 0) return "要改的原文在标准里出现了不止一次";
  if (next.trim() === old.trim()) return "改动前后相同";
  if (next.length - old.length > MAX_EDIT_GROWTH) return `新增超过 ${MAX_EDIT_GROWTH} 字`;
  if (next.length < old.length * (1 - MAX_EDIT_SHRINK)) return "删掉的内容太多（只允许补充和改写，不删规则）";
  const lostHeading = headings(old).find((h) => !next.includes(h.trim()));
  if (lostHeading) return `去掉了标题"${lostHeading.trim()}"`;
  const lostCode = codes(old).find((c) => !codes(next).includes(c));
  if (lostCode) return `去掉了类别 ${lostCode}`;
  return null;
}

const quote = (s: string) =>
  s
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/** 一次调整在 config/curation-changelog.md 里的记录（新的写在最前面） */
export function changelogEntry(input: {
  stamp: string;
  since: string;
  up: number;
  down: number;
  result: CurationTuneResult;
  apply: ApplyResult;
  backup: string | null;
}): string {
  const { stamp, since, up, down, result, apply, backup } = input;
  const lines = [`## ${stamp}`, "", `反馈：${since} 以来 ${up + down} 条（赞 ${up}，踩 ${down}）。${result.summary.trim()}`, ""];
  apply.applied.forEach((e, i) => {
    lines.push(`### 改动 ${i + 1}`, "", `理由：${e.why.trim()}`, "", "原文：", "", quote(e.old), "", "改为：", "", quote(e.new), "");
  });
  if (apply.rejected.length) {
    lines.push("### 没有采纳的建议", "");
    for (const { edit, problem } of apply.rejected) lines.push(`- ${problem}：${edit.why.trim()}`);
    lines.push("");
  }
  if (result.notes.length) {
    lines.push("### 其他建议（需要人工处理）", "");
    for (const n of result.notes) lines.push(`- ${n.trim()}`);
    lines.push("");
  }
  if (backup) lines.push(`修改前的版本：\`${backup}\`（撤销：\`pnpm feedback:tune --revert\`）`, "");
  return lines.join("\n");
}

export const CHANGELOG_HEADER = `# 精选标准变更记录

每天评审前（\`scripts/daily.sh\`），\`pnpm feedback:tune\` 根据上次以来后台的赞 / 踩自动修改 \`config/curation.md\`，每次的改动和理由记在这里（新的在前）。
不认可某次改动：运行 \`pnpm feedback:tune --revert\` 撤销最近一次，或者直接编辑 \`config/curation.md\`。

`;

/** 把新记录插到变更记录的说明之后、旧记录之前 */
export function prependChangelog(existing: string | null, entry: string): string {
  const head = CHANGELOG_HEADER.trimEnd();
  const body = existing?.startsWith(head) ? existing.slice(head.length) : (existing ?? "");
  return `${CHANGELOG_HEADER}${entry.trimEnd()}\n\n${body.trimStart()}`.trimEnd() + "\n";
}
