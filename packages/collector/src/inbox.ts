import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InboxFile } from "@xrss/core";
import { z } from "zod";
import { inboxDir } from "./paths.ts";

/** 采集目录里不属于账号数据的文件 */
const RESERVED = new Set(["plan.json", "detail-needed.json"]);

export interface InboxReadResult {
  files: InboxFile[];
  /** 无法解析或格式不符的文件 */
  invalid: Array<{ file: string; error: string }>;
  /** 采集端报告了限流、登录失效等问题的账号 */
  blocked: Array<{ handle: string; status: InboxFile["status"]; error?: string }>;
}

/** 读取某天采集端输出的所有账号文件（data/inbox/<date>/<handle>.json） */
export function readInbox(date: string, dir = inboxDir(date)): InboxReadResult {
  const result: InboxReadResult = { files: [], invalid: [], blocked: [] };
  if (!existsSync(dir)) return result;

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json") || RESERVED.has(name)) continue;
    const path = join(dir, name);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      result.invalid.push({ file: name, error: `不是合法 JSON：${(e as Error).message}` });
      continue;
    }
    const parsed = InboxFile.safeParse(json);
    if (!parsed.success) {
      result.invalid.push({ file: name, error: z.prettifyError(parsed.error) });
      continue;
    }
    result.files.push(parsed.data);
    if (parsed.data.status !== "ok") {
      result.blocked.push({ handle: parsed.data.handle, status: parsed.data.status, error: parsed.data.error });
    }
  }
  return result;
}
