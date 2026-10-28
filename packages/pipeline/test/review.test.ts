import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, RawTweet } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { describe, expect, it } from "vitest";
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
