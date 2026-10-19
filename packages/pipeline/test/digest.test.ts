import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AiResult, loadConfig, RawTweet } from "@xrss/core";
import { createDb, deliveries, migrateDb, subscribers, tweets } from "@xrss/core/db";
import { createSmtpMailer } from "@xrss/emails";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunk, groupKey, sendDigests } from "../src/digest.ts";

// 本地假 SMTP 服务：记录每封邮件的信封收件人和正文
const messages: Array<{ rcpt: string[]; data: string }> = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  server = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData(stream, session, cb) {
      let data = "";
      stream.on("data", (c) => (data += c));
      stream.on("end", () => {
        messages.push({ rcpt: session.envelope.rcptTo.map((r) => r.address), data });
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const repoConfig = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
// 测试自带主题，不依赖 config/topics.yaml 里的真实博主
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
  digest: { ...repoConfig.digest, mail: { ...repoConfig.digest.mail, group_identical: true, bcc_batch_size: 2, send_interval_ms: 0 } },
};

const ai = (topicId: string): AiResult => ({
  verdict: "keep",
  category: "best_practice",
  dropReason: null,
  quality: 8,
  topicId,
  summary: "示例",
  reason: "示例",
  zh: null,
  mediaNote: null,
});

const tweet = (id: string, handle: string, topicId: string) => {
  const raw = RawTweet.parse({
    id,
    url: `https://x.com/${handle}/status/${id}`,
    author: { handle, name: handle },
    createdAt: "2026-10-18T03:00:00Z",
    lang: "zh",
    text: `推文 ${id}`,
    metrics: { likes: 10, reposts: 1, replies: 0 },
  });
  return { id, handle, createdAt: new Date(raw.createdAt), kind: "text" as const, raw, engagement: 12, status: "scored" as const, ai: ai(topicId), topicId, finalScore: 0.8 };
};

describe("相同订阅合并发送", () => {
  it("分组和分批", () => {
    expect(groupKey({ lang: "zh", topics: ["crypto", "ai"] })).toBe(groupKey({ lang: "zh", topics: ["ai", "crypto"] }));
    expect(groupKey({ lang: "zh", topics: ["ai"] })).not.toBe(groupKey({ lang: "orig", topics: ["ai"] }));
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("同组只渲染一次、用密送分批发出；单人组单独发送并带专属链接；同一天不重复发", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrss-"));
    const db = createDb(`file:${join(dir, "app.db")}`);
    await migrateDb(db);
    await db.insert(tweets).values([tweet("101", "sama", "ai"), tweet("102", "cellinlab", "crypto")]);
    const sub = (email: string, lang: "zh" | "orig", topics: string[]) => ({ email, lang, topics, token: `t-${email}`, status: "active" as const });
    await db.insert(subscribers).values([
      sub("a@example.com", "zh", ["ai", "crypto"]),
      sub("b@example.com", "zh", ["crypto", "ai"]),
      sub("c@example.com", "zh", ["ai", "crypto"]),
      sub("d@example.com", "zh", ["ai"]),
      sub("e@example.com", "orig", ["ai", "crypto"]),
    ]);

    const mailer = createSmtpMailer({ host: "127.0.0.1", port, secure: false, user: "me@qq.com", pass: "x", from: "精选晨报 <me@qq.com>" }, { intervalMs: 0 });
    const range = { since: new Date("2026-10-17T16:00:00Z"), until: new Date("2026-10-18T16:00:00Z"), contentDate: "2026-10-18" };
    const opts = { date: "2026-10-19", range, now: new Date("2026-10-18T23:00:00Z"), dryRun: false, mailer };

    const first = await sendDigests(db, config, opts);
    expect(first).toMatchObject({ sent: 5, messages: 4, sharedGroups: 1, alreadySent: 0, failed: [] });

    // 3 人的组按每封 2 人分成 2 封，信封收件人只有订阅者（To 是发件人自己）
    const shared = messages.filter((m) => m.data.includes("/manage"));
    expect(shared).toHaveLength(2);
    expect(shared.flatMap((m) => m.rcpt).sort()).toEqual(["a@example.com", "b@example.com", "c@example.com", "me@qq.com", "me@qq.com"]);
    for (const m of shared) {
      expect(m.data).toMatch(/^To: me@qq\.com/m);
      expect(m.data).not.toMatch(/^Bcc:/m);
      expect(m.data).not.toContain("t-a@example.com");
    }
    // 单人组带专属链接和一键退订
    const personal = messages.filter((m) => m.rcpt.includes("d@example.com"));
    expect(personal).toHaveLength(1);
    expect(personal[0]!.data).toContain("List-Unsubscribe-Post");

    const rows = await db.select().from(deliveries);
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(5);

    messages.length = 0;
    const second = await sendDigests(db, config, opts);
    mailer.close();
    expect(second).toMatchObject({ sent: 0, messages: 0, alreadySent: 5 });
    expect(messages).toHaveLength(0);
  });
});
