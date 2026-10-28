import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, isSeq, type Pair, parse, parseDocument, type Scalar, type YAMLMap, type YAMLSeq } from "yaml";
import { z } from "zod";
import { DigestFile, TopicsFile } from "./config.ts";

/**
 * 后台账号管理改 config/topics.yaml 和 config/digest.yaml 用的函数。
 * 尽量只改动涉及的那一行，保留文件里的注释和对齐；遇到不常见的写法（如 [a, b] 这种行内列表）才整体重写。
 */

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** 把输入的 "@name"、"x.com/name"、"https://twitter.com/name" 统一成 name；不合法时返回 null */
export function normalizeHandle(input: string): string | null {
  const s = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.|mobile\.)?(x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return HANDLE.test(s) ? s : null;
}

const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
/** 行尾（含换行符） */
const lineEnd = (text: string, pos: number) => {
  const i = text.indexOf("\n", pos);
  return i === -1 ? text.length : i + 1;
};
const ensureNewline = (text: string, at: number) => (at > 0 && text[at - 1] !== "\n" ? "\n" : "");

interface Splice {
  from: number;
  to: number;
  insert: string;
}
function applySplices(text: string, splices: Splice[]): string {
  let out = text;
  for (const s of [...splices].sort((a, b) => b.from - a.from)) out = out.slice(0, s.from) + s.insert + out.slice(s.to);
  return out;
}

function topicNodes(text: string) {
  const doc = parseDocument(text);
  const topics = doc.get("topics", true);
  if (!isSeq(topics)) throw new Error("topics.yaml 里没有 topics 列表");
  const list = topics.items.filter(isMap).map((t) => ({ id: String(t.get("id")), name: String(t.get("name") ?? t.get("id")), node: t, accounts: t.get("accounts", true) as unknown }));
  return { doc, list };
}

/** 块状列表（每行一个 "- 账号"）的某一项所在行的前缀，如 "      - "；不是这种写法时返回 null */
function itemPrefix(text: string, item: Scalar): string | null {
  if (!item.range) return null;
  const prefix = text.slice(lineStart(text, item.range[0]), item.range[0]);
  return /^\s*-\s+$/.test(prefix) ? prefix : null;
}

/** 把账号加到主题的 accounts 末尾 */
export function addAccountToTopic(text: string, topicId: string, handle: string): string {
  const { doc, list } = topicNodes(text);
  const topic = list.find((t) => t.id === topicId);
  if (!topic) throw new Error(`没有主题 ${topicId}`);
  if (isSeq(topic.accounts) && topic.accounts.items.some((i) => isScalar(i) && same(i.value, handle))) throw new Error(`@${handle} 已经在「${topic.name}」里`);
  return appendAccounts(text, doc, topic, [handle]);
}

/** 一次加多个账号到主题末尾，已经在这个主题里的跳过 */
export function addAccountsToTopic(text: string, topicId: string, handles: string[]): string {
  const { doc, list } = topicNodes(text);
  const topic = list.find((t) => t.id === topicId);
  if (!topic) throw new Error(`没有主题 ${topicId}`);
  const have = new Set(isSeq(topic.accounts) ? topic.accounts.items.filter(isScalar).map((i) => String(i.value).toLowerCase()) : []);
  const fresh = handles.filter((h) => {
    const key = h.toLowerCase();
    if (have.has(key)) return false;
    have.add(key);
    return true;
  });
  return fresh.length ? appendAccounts(text, doc, topic, fresh) : text;
}

function appendAccounts(text: string, doc: ReturnType<typeof parseDocument>, topic: ReturnType<typeof topicNodes>["list"][number], handles: string[]): string {
  const seq = topic.accounts;
  if (!isSeq(seq)) throw new Error(`主题 ${topic.id} 没有 accounts 列表`);
  const last = seq.items.at(-1);
  const prefix = !seq.flow && isScalar(last) ? itemPrefix(text, last) : null;
  if (!prefix || !isScalar(last) || !last.range) {
    for (const h of handles) seq.add(h);
    return doc.toString({ lineWidth: 0 });
  }
  const at = lineEnd(text, last.range[1]);
  return text.slice(0, at) + ensureNewline(text, at) + handles.map((h) => `${prefix}${h}\n`).join("") + text.slice(at);
}

export interface NewTopic {
  id: string;
  name: string;
  color: string;
  description?: string;
}

/** 在 topics.yaml 末尾新建一个主题（带上账号，主题不能是空的），缩进和已有主题一致 */
export function addTopic(text: string, topic: NewTopic, handles: string[]): string {
  if (!handles.length) throw new Error("新主题至少要有一个账号");
  const { doc, list } = topicNodes(text);
  if (list.some((t) => t.id === topic.id)) throw new Error(`主题 ${topic.id} 已经存在`);
  const first = list[0]?.node;
  const prefix = first?.range ? text.slice(lineStart(text, first.range[0]), first.range[0]) : "";
  if (!/^\s*-\s+$/.test(prefix)) {
    (doc.get("topics", true) as YAMLSeq).add(doc.createNode({ ...topic, accounts: handles }));
    return doc.toString({ lineWidth: 0 });
  }
  const key = " ".repeat(prefix.length);
  const lines = [
    `${prefix}id: ${topic.id}`,
    `${key}name: ${JSON.stringify(topic.name)}`,
    `${key}color: "${topic.color}"`,
    ...(topic.description ? [`${key}description: ${JSON.stringify(topic.description)}`] : []),
    `${key}accounts:`,
    ...handles.map((h) => `${key}  - ${h}`),
  ];
  return `${text.replace(/\s*$/, "")}\n\n${lines.join("\n")}\n`;
}

/** 从主题里移出账号；不指定主题时从所有主题移出。主题不能因此变空 */
export function removeAccountFromTopics(text: string, handle: string, topicId?: string): string {
  const { doc, list } = topicNodes(text);
  const targets = list.filter((t) => (topicId ? t.id === topicId : true) && isSeq(t.accounts) && (t.accounts as YAMLSeq).items.some((i) => isScalar(i) && same(i.value, handle)));
  if (!targets.length) throw new Error(topicId ? `@${handle} 不在主题 ${topicId} 里` : `@${handle} 不在任何主题里`);

  const splices: Splice[] = [];
  let rewrite = false;
  for (const t of targets) {
    const seq = t.accounts as YAMLSeq;
    const keep = seq.items.filter((i) => !(isScalar(i) && same(i.value, handle)));
    if (!keep.length) throw new Error(`「${t.name}」只剩 @${handle} 一个账号，不能移出（每个主题至少要有一个账号）`);
    for (const item of seq.items) {
      if (!isScalar(item) || !same(item.value, handle)) continue;
      if (seq.flow || !itemPrefix(text, item) || !item.range) rewrite = true;
      else splices.push({ from: lineStart(text, item.range[0]), to: lineEnd(text, item.range[1]), insert: "" });
    }
    seq.items = keep;
  }
  return rewrite ? doc.toString({ lineWidth: 0 }) : applySplices(text, splices);
}

export interface WeightEntry {
  weight: number;
  /** 这一行的行尾注释（写原因用） */
  note?: string;
}

/** 读出 digest.yaml 的 account_weight，带上每行的注释；键是小写账号 */
export function readAccountWeights(text: string): Map<string, WeightEntry> {
  const map = parseDocument(text).get("account_weight", true);
  const out = new Map<string, WeightEntry>();
  if (!isMap(map)) return out;
  for (const p of map.items as Pair[]) {
    if (!isScalar(p.key) || !isScalar(p.value)) continue;
    const note = p.value.comment?.trim();
    out.set(String(p.key.value).toLowerCase(), { weight: Number(p.value.value), ...(note ? { note } : {}) });
  }
  return out;
}

const cleanNote = (note: string) => note.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

/**
 * 设置账号权重：weight 为 null 时删除这一项（恢复默认 1）。
 * note：写成行尾注释；不传时保留原来的注释，传空字符串时去掉。
 */
export function setAccountWeight(text: string, handle: string, weight: number | null, note?: string): string {
  const doc = parseDocument(text);
  const root = doc.contents;
  if (!isMap(root)) throw new Error("digest.yaml 格式不对");
  const rootPair = (root.items as Pair[]).find((p) => isScalar(p.key) && p.key.value === "account_weight");
  const map = rootPair?.value;
  const pairs = isMap(map) ? (map.items as Pair[]) : [];
  const pair = pairs.find((p) => isScalar(p.key) && same(p.key.value, handle));

  // 行尾注释和同组其他行的 # 对齐
  const commentCol = (() => {
    for (const p of pairs) {
      if (!isScalar(p.key) || !p.key.range || !isScalar(p.value) || !p.value.comment) continue;
      const ls = lineStart(text, p.key.range[0]);
      const hash = text.indexOf("#", p.value.range?.[1] ?? p.key.range[1]);
      if (hash !== -1 && hash < lineEnd(text, ls)) return hash - ls;
    }
    return 0;
  })();
  const keepNote = pair && isScalar(pair.value) ? pair.value.comment?.trim() : undefined;
  const finalNote = note === undefined ? keepNote : cleanNote(note);
  const line = (indent: string, key: string) => {
    const head = `${indent}${key}: ${weight}`;
    return finalNote ? `${head.padEnd(Math.max(commentCol, head.length + 2))}# ${finalNote}` : head;
  };

  const isBlock = isMap(map) && !map.flow;
  /** 块状写法（每行一个 "账号: 权重"）时返回键的位置，用来定位这一行 */
  const blockLine = (p: Pair) => (isBlock && isScalar(p.key) && p.key.range ? p.key.range : null);

  if (weight === null) {
    if (!pair) return text;
    const range = blockLine(pair);
    if (!range) {
      (map as YAMLMap).delete(pair.key);
      return doc.toString({ lineWidth: 0 });
    }
    const removed = applySplices(text, [{ from: lineStart(text, range[0]), to: lineEnd(text, range[1]), insert: "" }]);
    if (pairs.length > 1 || !isScalar(rootPair!.key) || !rootPair!.key.range) return removed;
    // 删掉最后一项后写成 account_weight: {}，否则值会变成空（null）
    const colon = removed.indexOf(":", rootPair!.key.range[1]);
    return removed.slice(0, colon + 1) + " {}" + removed.slice(colon + 1);
  }

  if (!Number.isFinite(weight) || weight < 0 || weight > 2) throw new Error("权重要在 0 到 2 之间");

  if (pair) {
    const range = blockLine(pair);
    if (!range) {
      pair.value = doc.createNode(weight);
      return doc.toString({ lineWidth: 0 });
    }
    const ls = lineStart(text, range[0]);
    const indent = text.slice(ls, range[0]);
    return text.slice(0, ls) + line(indent, String((pair.key as Scalar).value)) + "\n" + text.slice(lineEnd(text, range[1]));
  }

  const last = pairs.at(-1);
  const lastRange = last ? blockLine(last) : null;
  if (lastRange) {
    const ls = lineStart(text, lastRange[0]);
    const at = lineEnd(text, lastRange[1]);
    return text.slice(0, at) + ensureNewline(text, at) + line(text.slice(ls, lastRange[0]), handle) + "\n" + text.slice(at);
  }
  // account_weight 还是空的（{} 或没写）
  if (isMap(map) && map.flow && map.items.length === 0 && map.range && rootPair && isScalar(rootPair.key) && rootPair.key.range) {
    const keyIndent = text.slice(lineStart(text, rootPair.key.range[0]), rootPair.key.range[0]);
    return text.slice(0, map.range[0]).replace(/[ \t]+$/, "") + "\n" + line(`${keyIndent}  `, handle) + text.slice(map.range[1]);
  }
  doc.setIn(["account_weight", handle], weight);
  return doc.toString({ lineWidth: 0 });
}

function validate(file: string, text: string, schema: z.ZodType) {
  const parsed = schema.safeParse(parse(text));
  if (!parsed.success) throw new Error(`改完后 ${file} 不合法，没有保存：\n${z.prettifyError(parsed.error)}`);
}

/** 读出配置文件、改、校验、整体替换（先写临时文件再改名，避免读到写了一半的文件） */
export function editConfigFile(configDir: string, file: "topics.yaml" | "digest.yaml", edit: (text: string) => string): void {
  const path = join(configDir, file);
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  if (after === before) return;
  validate(file, after, file === "topics.yaml" ? TopicsFile : DigestFile);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, after);
  renameSync(tmp, path);
}
