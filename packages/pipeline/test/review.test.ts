import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, RawTweet } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { describe, expect, it } from "vitest";
import { rateAccounts } from "@xrss/collector";
import type { Reviewer } from "../src/ai.ts";
import { reviewCandidates } from "../src/review.ts";

const tweet = (id: string, text: string) =>
  RawTweet.parse({
    id,
    url: `https://x.com/a/status/${id}`,
    author: { handle: "a", name: "A" },
    createdAt: "2026-10-27T01:00:00Z",
    lang: "en",
    text,
    metrics: { likes: 1, reposts: 0, replies: 0 },
    media: [{ type: "photo", url: "https://a.b/c.jpg" }],
  });

describe("初审失败的处理", () => {
  it("只有一两句话的推文评审结果格式不符时按闲聊剔除，长推文仍记为失败、下次重试", async () => {
    const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
    const handle = config.accounts[0]!;
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    const rows = [tweet("1", "Not in SF today, back next week"), tweet("2", "word ".repeat(30))].map((raw) => ({
      id: raw.id,
      handle,
      createdAt: new Date(raw.createdAt),
      kind: "image" as const,
      raw,
      engagement: 1,
      status: "new" as const,
    }));
    await db.insert(tweets).values(rows);
    const reviewer: Reviewer = {
      async review() {
        throw new Error("评审结果格式不符：✖ Invalid option");
      },
    };
    const stats = await reviewCandidates(db, config, await db.select().from(tweets), reviewer, { strict: true });
    expect(stats).toMatchObject({ rejected: 1, failed: [{ id: "2" }] });
    const byId = new Map((await db.select().from(tweets)).map((t) => [t.id, t]));
    expect(byId.get("1")).toMatchObject({ status: "rejected", filterReason: expect.stringContaining("闲聊") });
    expect(byId.get("2")?.status).toBe("failed");
  });
});

describe("补评审（audit）", () => {
  it("结果记为 audited、不算最终分，但计入账号保留率", async () => {
    const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
    const handle = config.accounts[0]!;
    const topicId = config.accountTopics.get(handle)![0]!;
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    const raw = tweet("3", "A detailed walkthrough of how we evaluate agents in production. ".repeat(3));
    await db.insert(tweets).values({ id: raw.id, handle, createdAt: new Date(raw.createdAt), kind: "image", raw, engagement: 1, status: "new" });
    const reviewer: Reviewer = {
      async review() {
        return { verdict: "keep", category: "best_practice", dropReason: null, quality: 4, scale: 5, topicId, summary: "评测 Agent 的做法", reason: "有方法", zh: null, mediaNote: null };
      },
    };
    const stats = await reviewCandidates(db, config, await db.select().from(tweets), reviewer, { strict: true, audit: true });
    expect(stats).toMatchObject({ kept: 1, reviewed: 1 });
    const [row] = await db.select().from(tweets);
    expect(row).toMatchObject({ status: "audited", finalScore: null });
    const q = rateAccounts(config, [{ handle, status: row!.status, ai: row!.ai }], new Map(), new Date("2026-10-28T00:00:00Z"));
    expect(q.get(handle)).toMatchObject({ reviewed: 1, kept: 1 });
  });
});
