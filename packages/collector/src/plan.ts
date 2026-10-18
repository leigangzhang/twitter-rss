import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, localDate, runRange } from "@xrss/core";
import { accounts, type Db } from "@xrss/core/db";
import { inboxDir } from "./paths.ts";

export interface CrawlPlan {
  date: string;
  /** 只采集 [since, until) 之间发布的推文（默认是前一天 0:00–24:00，北京时间） */
  since: string;
  until: string;
  /** 内容所属日期，例如 2026-10-17 */
  contentDate: string;
  /** 采集时的节奏控制，交给 Browser Skill 执行 */
  pacing: {
    /** 每个主页之间随机停留的秒数范围 */
    delaySec: [number, number];
    /** 每次滚动之间的随机间隔（毫秒） */
    scrollPauseMs: [number, number];
    /** 每个主页最多滚动几屏，防止无限滚动 */
    maxScrolls: number;
    /** 遇到限流、登录失效或验证码时立即停止整个采集 */
    stopOnBlock: true;
  };
  accounts: Array<{
    handle: string;
    url: string;
    topics: string[];
    /** 遇到这个 ID（或更早的推文）就停止滚动 */
    lastSeenId: string | null;
  }>;
  output: {
    dir: string;
    /** 每个账号一个文件 */
    file: "<handle>.json";
    schema: string;
  };
}

/** 随机打乱，避免每天以相同顺序访问 */
function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function buildPlan(config: AppConfig, db: Db, now = new Date()): Promise<CrawlPlan> {
  const date = localDate(now, config.digest.timezone);
  const range = runRange(config, date, now);
  const known = new Map((await db.select().from(accounts)).map((a) => [a.handle, a]));
  const dir = inboxDir(date);

  return {
    date,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    contentDate: range.contentDate,
    pacing: { delaySec: [5, 20], scrollPauseMs: [800, 2500], maxScrolls: 8, stopOnBlock: true },
    accounts: shuffle(config.accounts).map((handle) => ({
      handle,
      url: `https://x.com/${handle}`,
      topics: config.accountTopics.get(handle) ?? [],
      lastSeenId: known.get(handle)?.lastSeenId ?? null,
    })),
    output: {
      dir,
      file: "<handle>.json",
      schema: join(config.configDir, "..", "schemas", "inbox-file.schema.json"),
    },
  };
}

export function writePlan(plan: CrawlPlan): string {
  mkdirSync(plan.output.dir, { recursive: true });
  const path = join(plan.output.dir, "plan.json");
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}
