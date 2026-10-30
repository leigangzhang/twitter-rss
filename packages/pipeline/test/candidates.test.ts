import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRange, loadConfig } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pickCandidates } from "../src/candidates.ts";
import { ingest } from "../src/ingest.ts";

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const config = { ...repoConfig, accounts: ["sama"], accountTopics: new Map([["sama", ["labs"]]]) };

const tweet = (id: string, createdAt: string) => ({
  id,
  url: `https://x.com/sama/status/${id}`,
  author: { handle: "sama", name: "sama", avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg" },
  createdAt,
  lang: "en",
  text: "A long enough tweet text about building with agents in production.",
  metrics: { likes: 10, reposts: 1, replies: 1 },
});

describe("挑选候选", () => {
  it("上次评审失败的推文重新作为候选，已评审过的不再送", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrss-inbox-"));
    process.env.INBOX_DIR = dir;
    const date = "2026-10-19";
    const range = collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, date, new Date("2026-10-18T23:00:00Z"));
    mkdirSync(join(dir, date), { recursive: true });
    writeFileSync(
      join(dir, date, "sama.json"),
      JSON.stringify({
        source: "test",
        collectedAt: "2026-10-18T23:30:00Z",
        handle: "sama",
        status: "ok",
        tweets: [tweet("301", "2026-10-18T03:00:00Z"), tweet("302", "2026-10-18T04:00:00Z"), tweet("303", "2026-10-18T05:00:00Z")],
      }),
    );
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    await ingest(db, config, date, { ...range, runDate: date });
    await db.update(tweets).set({ status: "failed", filterReason: "401 Authentication Fails" }).where(eq(tweets.id, "301"));
    await db.update(tweets).set({ status: "scored" }).where(eq(tweets.id, "302"));

    const picked = await pickCandidates(db, config, { ...range, runDate: date });
    expect(picked.map((t) => t.id).sort()).toEqual(["301", "303"]);
    delete process.env.INBOX_DIR;
  });

  it("每个主题的候选数按天计算：同一天重跑只重试失败的，不再多挑新的", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrss-inbox-"));
    process.env.INBOX_DIR = dir;
    const date = "2026-10-19";
    const range = { ...collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, date, new Date("2026-10-18T23:00:00Z")), runDate: date };
    mkdirSync(join(dir, date), { recursive: true });
    const list = ["401", "402", "403", "404"].map((id, i) => tweet(id, `2026-10-18T0${i + 1}:00:00Z`));
    writeFileSync(join(dir, date, "sama.json"), JSON.stringify({ source: "test", collectedAt: "2026-10-18T23:30:00Z", handle: "sama", status: "ok", tweets: list }));
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    await ingest(db, config, date, range);
    const daily = { ...config, digest: { ...config.digest, digest: { ...config.digest.digest, candidates_per_topic: 2 } } };

    const first = await pickCandidates(db, daily, range);
    expect(first).toHaveLength(2);
    // 第一次评审：一条通过，一条失败
    await db.update(tweets).set({ status: "scored" }).where(eq(tweets.id, first[0]!.id));
    await db.update(tweets).set({ status: "failed" }).where(eq(tweets.id, first[1]!.id));

    const second = await pickCandidates(db, daily, range);
    expect(second.map((t) => t.id)).toEqual([first[1]!.id]);
    delete process.env.INBOX_DIR;
  });
  it("candidates_per_topic 为 0 时不设上限，全部送评审", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrss-inbox-"));
    process.env.INBOX_DIR = dir;
    const date = "2026-10-19";
    const range = { ...collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, date, new Date("2026-10-18T23:00:00Z")), runDate: date };
    mkdirSync(join(dir, date), { recursive: true });
    const list = ["501", "502", "503", "504"].map((id, i) => tweet(id, `2026-10-18T0${i + 1}:00:00Z`));
    writeFileSync(join(dir, date, "sama.json"), JSON.stringify({ source: "test", collectedAt: "2026-10-18T23:30:00Z", handle: "sama", status: "ok", tweets: list }));
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    await ingest(db, config, date, range);
    const unlimited = { ...config, digest: { ...config.digest, digest: { ...config.digest.digest, candidates_per_topic: 0 } } };

    const picked = await pickCandidates(db, unlimited, range);
    expect(picked.map((t) => t.id).sort()).toEqual(["501", "502", "503", "504"]);
    delete process.env.INBOX_DIR;
  });
});
