export interface Scored {
  id: string;
  topicId: string;
  finalScore: number;
}

export interface SelectOptions {
  /** 订阅者选的主题，按 topics.yaml 顺序 */
  topicOrder: string[];
  total: number;
  minPerTopic: number;
}

export interface TopicGroup<T> {
  topicId: string;
  items: T[];
}

const byScore = <T extends Scored>(a: T, b: T) => b.finalScore - a.finalScore || a.id.localeCompare(b.id);

/**
 * 为一位订阅者选稿：
 * 1. 每个订阅主题先保底 minPerTopic 条（当天有合格内容时）；
 *    如果保底总数已超过 total，按分数保留最好的 total 条。
 * 2. 剩余名额从所有订阅主题中按分数补足。
 * 3. 按主题分组（主题按订阅顺序），组内按分数排序；没有内容的主题不出现。
 */
export function selectForSubscriber<T extends Scored>(candidates: T[], opts: SelectOptions): TopicGroup<T>[] {
  const subscribed = new Set(opts.topicOrder);
  const pool = candidates.filter((c) => subscribed.has(c.topicId)).sort(byScore);

  const picked = new Map<string, T>();

  const guaranteed: T[] = [];
  for (const topicId of opts.topicOrder) {
    guaranteed.push(...pool.filter((c) => c.topicId === topicId).slice(0, opts.minPerTopic));
  }
  for (const c of guaranteed.sort(byScore).slice(0, opts.total)) picked.set(c.id, c);

  for (const c of pool) {
    if (picked.size >= opts.total) break;
    if (!picked.has(c.id)) picked.set(c.id, c);
  }

  return opts.topicOrder
    .map((topicId) => ({
      topicId,
      items: [...picked.values()].filter((c) => c.topicId === topicId).sort(byScore),
    }))
    .filter((g) => g.items.length > 0);
}

export interface FeedIssue<T> {
  /** 期号（运行日期，YYYY-MM-DD），和邮件同一期 */
  date: string;
  items: T[];
}

/**
 * 单个主题 Feed 的选稿，规则和邮件一致：按期（运行日期）分组，每期按订阅了这一个主题的邮件选稿
 * （total、minPerTopic、综合分排序，综合分已含视频降权和账号权重），期号从新到旧。
 * 每期整期收录，攒够 limit 条后不再加更早的期。
 */
export function selectFeedIssues<T extends Scored & { issueDate: string }>(
  candidates: T[],
  opts: { topicId: string; total: number; minPerTopic: number; limit: number },
): FeedIssue<T>[] {
  const byDate = new Map<string, T[]>();
  for (const c of candidates) if (c.topicId === opts.topicId) byDate.set(c.issueDate, [...(byDate.get(c.issueDate) ?? []), c]);
  const issues: FeedIssue<T>[] = [];
  let left = opts.limit;
  for (const date of [...byDate.keys()].sort().reverse()) {
    if (left <= 0) break;
    const [group] = selectForSubscriber(byDate.get(date)!, { topicOrder: [opts.topicId], total: opts.total, minPerTopic: opts.minPerTopic });
    const items = group?.items ?? [];
    left -= items.length;
    if (items.length) issues.push({ date, items });
  }
  return issues;
}
