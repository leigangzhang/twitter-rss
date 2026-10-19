import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AiResult, loadConfig, RawTweet } from "@xrss/core";
import { createDb, deliveries, deliveryAttempts, migrateDb, subscribers, tweets } from "@xrss/core/db";
import type { Mailer, OutgoingMail } from "@xrss/emails";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildIssueEmail, issueDetail, listIssues, resendTo, retryFailed, sendMissing } from "../src/delivery.ts";

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
const topics = [
  { id: "ai", name: "AI", color: "#1F5FD6", aliases: [], accounts: ["sama"] },
  { id: "crypto", name: "加密", color: "#B85A0A", aliases: [], accounts: ["cellinlab"] },
];
const config = {
  ...repoConfig,
  topics,
  accounts: ["sama", "cellinlab"],
  accountTopics: new Map([
    ["sama", ["ai"]],
    ["cellinlab", ["crypto"]],
  ]),
  topicAliases: new Map<string, string>(),
  digest: { ...repoConfig.digest, mail: { ...repoConfig.digest.mail, group_identical: true, bcc_batch_size: 20, send_interval_ms: 0 } },
};

const ai = (topicId: string): AiResult => ({ verdict: "keep", category: "best_practice", dropReason: null, quality: 4, scale: 5, topicId, summary: `摘要 ${topicId}`, reason: "r", zh: null, mediaNote: null });
const tweet = (id: string, handle: string, topicId: string) => {
  const raw = RawTweet.parse({ id, url: `https://x.com/${handle}/status/${id}`, author: { handle, name: handle }, createdAt: "2026-10-18T03:00:00Z", lang: "zh", text: `推文 ${id} 的正文内容`, metrics: { likes: 10, reposts: 1, replies: 0 } });
  return { id, handle, createdAt: new Date(raw.createdAt), kind: "text" as const, raw, engagement: 1, status: "scored" as const, ai: ai(topicId), topicId, finalScore: 0.8, batchDate: "2026-10-19" };
};

function fakeMailer(fail: string[] = []) {
  const sent: OutgoingMail[] = [];
  const mailer: Mailer = {
    address: "me@qq.com",
    async send(m) {
      const to = [m.to, ...(m.bcc ?? [])].flat().filter((x): x is string => typeof x === "string" && x !== "me@qq.com");
      if (to.some((t) => fail.includes(t))) throw new Error("SMTP 连接超时");
      sent.push(m);
      return { id: `<${sent.length}@test>`, accepted: to, rejected: [] };
    },
    close() {},
  };
  return { mailer, sent };
}

describe("推送历史与重新推送", () => {
  it("列出每期结果、重试失败、补发漏发、重新发送，并记下每次发送", async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    await db.insert(tweets).values([tweet("101", "sama", "ai"), tweet("102", "cellinlab", "crypto")]);
    const confirmed = new Date("2026-10-18T12:00:00Z");
    const sub = (email: string, topicIds: string[], at = confirmed) => ({ email, lang: "zh" as const, topics: topicIds, token: `t-${email}`, status: "active" as const, createdAt: at, confirmedAt: at });
    const [a, b, c] = await db
      .insert(subscribers)
      .values([sub("a@example.com", ["ai"]), sub("b@example.com", ["ai", "crypto"]), sub("c@example.com", ["crypto"]), sub("late@example.com", ["ai"], new Date("2026-10-20T03:00:00Z"))])
      .returning();
    const date = "2026-10-19";
    await db.insert(deliveries).values([
      { subscriberId: a!.id, digestDate: date, tweetIds: ["101"], status: "sent", messageId: "<m1>" },
      { subscriberId: b!.id, digestDate: date, tweetIds: ["101", "102"], status: "failed", error: "SMTP 连接超时" },
    ]);

    // 当期：成功 1、失败 1、漏发 1（c）；晚于当期才确认的 late 不算漏发
    expect((await listIssues(db, config))[0]).toMatchObject({ date, periodLabel: "10月18日", sent: 1, failed: 1, missing: 1, items: 2 });
    const detail = await issueDetail(db, config, date);
    expect(detail!.recipients.map((r) => [r.subscriber.email, r.status])).toEqual([
      ["b@example.com", "failed"],
      ["c@example.com", "missing"],
      ["a@example.com", "sent"],
    ]);
    expect(detail!.list.map((i) => [i.id, i.receivedBy])).toEqual([
      ["101", 2],
      ["102", 1],
    ]);

    // 查看已发出的：按当时的推文重建（b 当时是 101、102 中失败的那封，a 只收到 101）
    const sentView = await buildIssueEmail(db, config, date, a!.id, "sent");
    expect("email" in sentView && sentView.tweetIds).toEqual(["101"]);

    // 当天又补采到新内容：a 重新发送时按最新内容，包含新的 103
    await db.insert(tweets).values(tweet("103", "sama", "ai"));
    const latest = await buildIssueEmail(db, config, date, a!.id);
    expect("email" in latest && [...latest.tweetIds].sort()).toEqual(["101", "103"]);
    const m0 = fakeMailer();
    expect(await resendTo(db, config, m0.mailer, date, a!.id)).toEqual({ email: "a@example.com", status: "sent", message: "已发送（2 条，比上次多 1 条新内容）" });
    expect((await db.select().from(deliveries).where(eq(deliveries.subscriberId, a!.id)))[0]!.tweetIds.sort()).toEqual(["101", "103"]);

    // 重试失败的：b 收到个人邮件，最终结果改为成功
    const m1 = fakeMailer();
    expect(await retryFailed(db, config, m1.mailer, date)).toEqual([{ email: "b@example.com", status: "sent", message: "已发送（3 条）" }]);
    expect(m1.sent[0]!.to).toBe("b@example.com");
    expect(String(m1.sent[0]!.html)).toContain("t-b@example.com");

    // 补发：只发给 c，不发给 late
    const m2 = fakeMailer();
    expect(await sendMissing(db, config, m2.mailer, date)).toMatchObject({ sent: 1 });
    expect(m2.sent.map((m) => m.to)).toEqual(["c@example.com"]);
    expect(await sendMissing(db, config, fakeMailer().mailer, date)).toMatchObject({ sent: 0 });

    // 重新发送失败时，不覆盖之前成功的结果
    expect(await resendTo(db, config, fakeMailer(["a@example.com"]).mailer, date, a!.id)).toMatchObject({ status: "failed", message: "SMTP 连接超时" });
    const [rowA] = await db.select().from(deliveries).where(eq(deliveries.subscriberId, a!.id));
    expect(rowA!.status).toBe("sent");

    const log = await db.select().from(deliveryAttempts);
    expect(log.map((l) => [l.kind, l.status]).sort()).toEqual([
      ["missing", "sent"],
      ["resend", "failed"],
      ["resend", "sent"],
      ["retry", "sent"],
    ]);
    expect((await listIssues(db, config))[0]).toMatchObject({ sent: 3, failed: 0, missing: 0, attempts: 4 });
    expect(c).toBeDefined();
  });
});
