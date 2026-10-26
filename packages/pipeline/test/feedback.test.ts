import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRange, loadConfig } from "@xrss/core";
import { adminFeedbackCounts, adminVotes, createDb, deliveries, feedback, listFeedback, migrateDb, setAdminFeedback, subscribers } from "@xrss/core/db";
import { feedbackTarget, injectVoteScript, previewBanner } from "../src/admin-preview.ts";
import { summarizeFeedback } from "../src/feedback-summary.ts";
import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest.ts";

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const config = { ...repoConfig, accounts: ["sama"], accountTopics: new Map([["sama", ["labs"]]]) };

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

describe("后台反馈", () => {
  it("后台评价：每条只留一条，再点同一个取消；换评价清掉原因；早先读者的评价不受影响", async () => {
    const { db, sub } = await setup();
    const base = { tweetId: "501", issueDate: "2026-10-19" };
    // 早先邮件反馈留下的读者评价
    await db.insert(feedback).values({ ...base, vote: "up", subscriberId: sub.id, source: "reader" });

    await setAdminFeedback(db, { ...base, vote: "down" });
    await setAdminFeedback(db, { ...base, vote: "down", reason: "shallow" });
    await setAdminFeedback(db, { ...base, vote: "down", note: "  只是转述新闻  " });
    expect(await adminVotes(db, ["501", "999"])).toEqual({ "501": { vote: "down", reason: "shallow", note: "只是转述新闻" } });

    // 再点一次"踩"本身（不带原因）不会清掉已选的原因
    await setAdminFeedback(db, { ...base, vote: "down" });
    expect((await adminVotes(db, ["501"]))["501"]?.reason).toBe("shallow");

    await setAdminFeedback(db, { ...base, vote: "up" });
    expect(await adminVotes(db, ["501"])).toEqual({ "501": { vote: "up", reason: null, note: null } });
    await setAdminFeedback(db, { ...base, vote: "down" });
    expect(await adminVotes(db, ["501"])).toEqual({ "501": { vote: "down", reason: null, note: null } });

    await setAdminFeedback(db, { ...base, vote: null });
    expect(await adminVotes(db, ["501"])).toEqual({});
    const rows = await db.select().from(feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "reader", subscriberId: sub.id, vote: "up" });
  });

  it("汇总：只列 👎，按账号、主题、类别、原因计数；按期数筛选", async () => {
    const { db } = await setup();
    await setAdminFeedback(db, { tweetId: "501", issueDate: "2026-10-19", vote: "down", reason: "ad" });
    const list = await listFeedback(db, { from: "2026-10-13", to: "2026-10-19" });
    expect(await listFeedback(db, { from: "2026-10-20" })).toHaveLength(0);
    const s = summarizeFeedback(list);
    expect(s.up).toBe(0);
    expect(s.down.map((f) => [f.handle, f.source])).toEqual([["sama", "admin"]]);
    expect(s.byHandle).toEqual([["sama", 1]]);
    expect(s.byReason).toEqual([["ad", 1]]);
  });

  it("预览脚本带上已有评价，并转义 <", () => {
    const html = injectVoteScript("<html><body><p>x</p></body></html>", { "501": { vote: "down", reason: null, note: "</script><b>" } });
    expect(html).toMatch(/<script>[\s\S]*<\/script><\/body><\/html>$/);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('"501":{"vote":"down"');
  });

  it("预览顶部说明转义 HTML", () => {
    expect(previewBanner("共 <b>60</b> 条 & 更多")).toContain("共 &lt;b>60&lt;/b> 条 &amp; 更多");
  });

  it("今日反馈：最近一期；优先管理员自己收到的，否则收到最多的那位；可指定日期和订阅者", async () => {
    const { db, sub } = await setup();
    const [other] = await db.insert(subscribers).values({ email: "big@example.com", topics: ["labs"], token: "tok_big_1234567890", status: "active" }).returning();
    await db.insert(deliveries).values([
      { subscriberId: sub.id, digestDate: "2026-10-19", tweetIds: ["501"], status: "sent" },
      { subscriberId: other!.id, digestDate: "2026-10-19", tweetIds: ["501", "502"], status: "sent" },
      { subscriberId: other!.id, digestDate: "2026-10-20", tweetIds: ["501"], status: "failed" },
    ]);
    expect(await feedbackTarget(db)).toEqual({ date: "2026-10-19", subscriberId: other!.id });
    expect(await feedbackTarget(db, { adminEmail: " Reader@example.com " })).toEqual({ date: "2026-10-19", subscriberId: sub.id });
    expect(await feedbackTarget(db, { subscriberId: sub.id })).toEqual({ date: "2026-10-19", subscriberId: sub.id });
    expect(await feedbackTarget(db, { date: "2026-10-20" })).toBeNull();

    await setAdminFeedback(db, { tweetId: "501", issueDate: "2026-10-19", vote: "down" });
    expect(await adminFeedbackCounts(db)).toEqual(new Map([["2026-10-19", { up: 0, down: 1 }]]));
  });
});
