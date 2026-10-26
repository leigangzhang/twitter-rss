import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRange, loadConfig } from "@xrss/core";
import { createDb, feedback, feedbackLinks, feedbackSignature, migrateDb, parseFeedbackParams, recordFeedback, subscribers, verifyFeedback } from "@xrss/core/db";
import { afterEach, describe, expect, it } from "vitest";
import { feedbackLinker } from "../src/digest.ts";
import { ingest } from "../src/ingest.ts";

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const config = { ...repoConfig, accounts: ["sama"], accountTopics: new Map([["sama", ["labs"]]]) };
const withFeedback = { ...config, digest: { ...config.digest, mail: { ...config.digest.mail, feedback: true } } };

const paramsOf = (url: string) => {
  const q = new URL(url).searchParams;
  return parseFeedbackParams((k) => q.get(k));
};

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "xrss-inbox-"));
  process.env.INBOX_DIR = dir;
  const date = "2026-10-19";
  const range = { ...collectRange({ mode: "previous_day", timezone: "Asia/Shanghai", windowHours: 24 }, date, new Date("2026-10-18T23:00:00Z")), runDate: date };
  mkdirSync(join(dir, date), { recursive: true });
  const tweet = {
    id: "501",
    url: "https://x.com/sama/status/501",
    author: { handle: "sama", name: "sama", avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg" },
    createdAt: "2026-10-18T03:00:00Z",
    lang: "en",
    text: "A long enough tweet text about building with agents in production.",
    metrics: { likes: 10, reposts: 1, replies: 1 },
  };
  writeFileSync(join(dir, date, "sama.json"), JSON.stringify({ source: "test", collectedAt: "2026-10-18T23:30:00Z", handle: "sama", status: "ok", tweets: [tweet] }));
  const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
  await migrateDb(db);
  await ingest(db, config, date, range);
  const [sub] = await db.insert(subscribers).values({ email: "reader@example.com", topics: ["labs"], token: "tok_reader_1234567890", status: "active" }).returning();
  delete process.env.INBOX_DIR;
  return { db, sub: sub! };
}

describe("反馈链接", () => {
  afterEach(() => {
    delete process.env.FEEDBACK_SECRET;
  });

  it("单独发送带 token，合并发送带签名；参数格式不对时拒绝", () => {
    const own = feedbackLinks("https://xrss.example/", { token: "tok" }, "501", "2026-10-19");
    expect(own.up).toBe("https://xrss.example/f?t=501&d=2026-10-19&s=tok&v=up");
    expect(paramsOf(own.down)).toEqual({ tweetId: "501", issueDate: "2026-10-19", vote: "down", token: "tok", signature: undefined });

    const shared = feedbackLinks("https://xrss.example", { secret: "s3cret" }, "501", "2026-10-19");
    expect(paramsOf(shared.up)?.signature).toBe(feedbackSignature("s3cret", "501", "2026-10-19"));

    expect(paramsOf("https://x/f?t=abc&d=2026-10-19&s=tok&v=up")).toBeNull();
    expect(paramsOf("https://x/f?t=501&d=2026-10-19&v=up")).toBeNull();
    expect(paramsOf("https://x/f?t=501&d=2026-10-19&s=tok&v=meh")).toBeNull();
  });

  it("没开启 mail.feedback 时不放链接；合并发送没有 FEEDBACK_SECRET 时也不放", () => {
    expect(feedbackLinker(config, "2026-10-19", { token: "tok" })).toBeUndefined();
    expect(feedbackLinker(config, "2026-10-19", { token: "tok" }, true)?.("501").up).toContain("s=tok");
    expect(feedbackLinker(withFeedback, "2026-10-19", "shared")).toBeUndefined();
    process.env.FEEDBACK_SECRET = "s3cret";
    expect(feedbackLinker(withFeedback, "2026-10-19", "shared")?.("501").up).toContain("g=");
  });

  it("校验：token 要对应订阅者、签名要对、推文要存在", async () => {
    const { db, sub } = await setup();
    const req = { tweetId: "501", issueDate: "2026-10-19", vote: "up" as const };
    expect(await verifyFeedback(db, { ...req, token: sub.token })).toEqual({ subscriberId: sub.id });
    expect(await verifyFeedback(db, { ...req, token: "nobody" })).toBeNull();
    expect(await verifyFeedback(db, { ...req, tweetId: "999", token: sub.token })).toBeNull();
    const signature = feedbackSignature("s3cret", "501", "2026-10-19");
    expect(await verifyFeedback(db, { ...req, signature }, "s3cret")).toEqual({ subscriberId: null });
    expect(await verifyFeedback(db, { ...req, signature }, "other")).toBeNull();
    expect(await verifyFeedback(db, { ...req, signature }, undefined)).toBeNull();
  });

  it("同一订阅者重复反馈覆盖上一次，👍 不留原因；匿名反馈每次新增", async () => {
    const { db, sub } = await setup();
    const base = { tweetId: "501", issueDate: "2026-10-19" };
    await recordFeedback(db, { ...base, vote: "down", reason: "ad", subscriberId: sub.id });
    await recordFeedback(db, { ...base, vote: "down", reason: "shallow", subscriberId: sub.id });
    let rows = await db.select().from(feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vote: "down", reason: "shallow", subscriberId: sub.id });

    await recordFeedback(db, { ...base, vote: "up", reason: "ad", subscriberId: sub.id });
    rows = await db.select().from(feedback);
    expect(rows[0]).toMatchObject({ vote: "up", reason: null });

    await recordFeedback(db, { ...base, vote: "up", reason: null, subscriberId: null });
    await recordFeedback(db, { ...base, vote: "down", reason: null, subscriberId: null });
    expect(await db.select().from(feedback)).toHaveLength(3);
  });
});
