import type { TimeRange } from "@xrss/core";
import { tweets } from "@xrss/core/db";
import { and, eq, gte, isNull, lt, or, type SQL } from "drizzle-orm";

/**
 * 本次运行要处理的推文：本次入库的（含补收的前几天内容）。
 * 加 batch_date 之前入库的旧数据没有批次，按发布时间落在本次时间范围内判断。
 */
export function inBatch(range: TimeRange): SQL {
  const byTime = and(gte(tweets.createdAt, range.since), lt(tweets.createdAt, range.until))!;
  if (!range.runDate) return byTime;
  return or(eq(tweets.batchDate, range.runDate), and(isNull(tweets.batchDate), byTime))!;
}
