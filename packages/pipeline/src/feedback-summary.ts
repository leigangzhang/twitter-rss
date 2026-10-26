import type { FeedbackInfo } from "@xrss/core/db";

export interface FeedbackSummary {
  up: number;
  /** 👎 的条目，按期数从新到旧 */
  down: FeedbackInfo[];
  /** 👎 的计数，多的在前；没有的值记为 "?"，没选原因的记为 "未选" */
  byHandle: Array<[string, number]>;
  byTopic: Array<[string, number]>;
  byCategory: Array<[string, number]>;
  byReason: Array<[string, number]>;
}

function count(list: FeedbackInfo[], key: (f: FeedbackInfo) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const f of list) m.set(key(f), (m.get(key(f)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** 汇总一段时间的反馈，用来找评审规则该改哪里 */
export function summarizeFeedback(list: FeedbackInfo[]): FeedbackSummary {
  const down = list.filter((f) => f.vote === "down").sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  return {
    up: list.length - down.length,
    down,
    byHandle: count(down, (f) => f.handle ?? "?"),
    byTopic: count(down, (f) => f.topicId ?? "?"),
    byCategory: count(down, (f) => f.ai?.category ?? "?"),
    byReason: count(down, (f) => f.reason ?? "未选"),
  };
}
