import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRange, loadConfig } from "@xrss/core";
import { accounts, createDb, migrateDb, tweets } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest.ts";

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const config = { ...repoConfig, accounts: ["sama", "cellinlab"], accountTopics: new Map([["sama", ["labs"]], ["cellinlab", ["cn-insight"]]]) };

const tweet = (id: string, handle: string, createdAt: string) => ({
  id,
  url: `https://x.com/${handle}/status/${id}`,
  author: { handle, name: handle, avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg" },
  createdAt,
  lang: "en",
  text: "A long enough tweet text about building with agents in production.",
  metrics: { likes: 10, reposts: 1, replies: 1 },
});

describe("入库：轮转账号补收前几天的内容", () => {
  it("从上次覆盖到的时间点补收，最多 catch_up_days 天，记录批次和覆盖时间", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrss-inbox-"));
    process.env.INBOX_DIR = dir;
    const date = "2026-10-19";
    const range = collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, date, new Date("2026-10-18T23:00:00Z"));
    mkdirSync(join(dir, date), { recursive: true });
    const write = (handle: string, list: unknown[]) =>
      writeFileSync(join(dir, date, `${handle}.json`), JSON.stringify({ source: "test", collectedAt: "2026-10-18T23:30:00Z", handle, status: "ok", tweets: list }));
    write("sama", [
      tweet("104", "sama", "2026-10-18T20:00:00Z"), // 今天新发的，明天再收
      tweet("103", "sama", "2026-10-18T03:00:00Z"), // 前一天
      tweet("102", "sama", "2026-10-16T05:00:00Z"), // 上次没轮到的那天，补收
      tweet("101", "sama", "2026-10-14T05:00:00Z"), // 已经覆盖过
    ]);
    write("cellinlab", [tweet("202", "cellinlab", "2026-10-18T03:00:00Z"), tweet("201", "cellinlab", "2026-10-16T05:00:00Z")]);

    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    // sama 上次入库覆盖到 10 月 16 日 0 点（北京时间），cellinlab 从没采过
    await db.insert(accounts).values({ handle: "sama", coveredUntil: new Date("2026-10-15T16:00:00Z") });

    const stats = await ingest(db, config, date, range);
    expect(stats).toMatchObject({ stored: 3, caughtUp: 1, outOfRange: 3 });
    const stored = await db.select({ id: tweets.id, batchDate: tweets.batchDate }).from(tweets);
    expect(stored.map((t) => t.id).sort()).toEqual(["102", "103", "202"]);
    expect(new Set(stored.map((t) => t.batchDate))).toEqual(new Set([date]));

    const [sama] = await db.select().from(accounts).where(eq(accounts.handle, "sama"));
    expect(sama!.coveredUntil).toEqual(range.until);
    expect(sama!.lastTweetAt).toEqual(new Date("2026-10-18T20:00:00Z"));
    expect(sama!.avatarUrl).toBe("https://pbs.twimg.com/profile_images/1/a_bigger.jpg");
    delete process.env.INBOX_DIR;
  });
});
