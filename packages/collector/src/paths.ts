import { join } from "node:path";
import { findRepoRoot } from "@xrss/core";

export function inboxDir(date: string): string {
  // INBOX_DIR 用于测试或把采集结果放到别处
  return join(process.env.INBOX_DIR ?? join(findRepoRoot(), "data", "inbox"), date);
}
