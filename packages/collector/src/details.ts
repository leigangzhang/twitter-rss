import type { CrawlConfig } from "@xrss/core";
import { createBreaker } from "./plan.ts";
import type { Random } from "./random.ts";
import type { DetailTarget } from "./parsers/x-graphql.ts";

export interface DetailCandidate extends DetailTarget {
  handle: string;
  /** 加权互动数，用于在预算不够时排优先级 */
  engagement: number;
}

export interface ScheduledDetail extends DetailCandidate {
  /** 打开这个详情页之前等待的秒数 */
  waitBeforeSec: number;
  /** 不为 0 时，先额外休息这么多秒 */
  longBreakBeforeSec: number;
}

/**
 * 在预算内安排详情页补抓：互动越高越优先，超出预算的不补抓（邮件里会提示"全文较长"）。
 * 同一账号的详情页尽量不连续打开，降低对单个账号的访问密度。
 */
export function scheduleDetails(
  candidates: DetailCandidate[],
  budget: number,
  crawl: CrawlConfig,
  rng: Random,
): { scheduled: ScheduledDetail[]; overBudget: DetailCandidate[] } {
  const sorted = [...candidates].sort((a, b) => b.engagement - a.engagement || a.id.localeCompare(b.id));
  const picked = sorted.slice(0, Math.max(0, budget));
  const overBudget = sorted.slice(Math.max(0, budget));

  // 交错排列：每次尽量选一个与上一条不同账号的
  const queue = [...picked];
  const ordered: DetailCandidate[] = [];
  while (queue.length > 0) {
    const prev = ordered.at(-1)?.handle;
    const idx = queue.findIndex((c) => c.handle !== prev);
    ordered.push(queue.splice(idx === -1 ? 0 : idx, 1)[0]!);
  }

  const breaker = createBreaker(crawl, rng);
  const scheduled = ordered.map((c, i) => ({
    ...c,
    waitBeforeSec: rng.int(crawl.pacing.detail_delay_sec),
    longBreakBeforeSec: i === 0 ? 0 : breaker(),
  }));
  return { scheduled, overBudget };
}
