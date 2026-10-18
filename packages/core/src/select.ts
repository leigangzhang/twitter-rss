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
