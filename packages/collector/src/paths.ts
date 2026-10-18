import { join } from "node:path";
import { findRepoRoot } from "@xrss/core";

export function inboxDir(date: string): string {
  return join(findRepoRoot(), "data", "inbox", date);
}
