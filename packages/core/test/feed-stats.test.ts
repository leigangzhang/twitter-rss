import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb, feedStats, migrateDb, parseFeedClient, recordFeedHit } from "../src/db/index.ts";

const FEEDLY = "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 16 subscribers; like FeedFetcher-Google)";
const INOREADER = "Mozilla/5.0 (compatible; Inoreader/1.0; https://www.inoreader.com; 9 subscribers)";
const NNW = "NetNewsWire (RSS Reader; https://netnewswire.com/)";

describe("parseFeedClient", () => {
  it("认出聚合服务和它报告的订阅数", () => {
    expect(parseFeedClient(FEEDLY)).toEqual({ client: "Feedly", subscribers: 16, aggregator: true });
    expect(parseFeedClient(INOREADER)).toEqual({ client: "Inoreader", subscribers: 9, aggregator: true });
  });
  it("认出普通阅读器，认不出的归为浏览器或其他", () => {
    expect(parseFeedClient(NNW)).toEqual({ client: "NetNewsWire", subscribers: undefined, aggregator: false });
    expect(parseFeedClient("Mozilla/5.0 (Macintosh) Safari/605").client).toBe("浏览器或未识别");
    expect(parseFeedClient("").client).toBe("未知");
  });
});

describe("feedStats", () => {
  it("同一读者一天多次只算一次，聚合服务按报告的订阅数算人", async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    const hit = (date: string, slug: string, ip: string, userAgent: string) => recordFeedHit(db, { date, slug, ip, userAgent });
    await hit("2026-10-27", "labs.zh.xml", "1.1.1.1", FEEDLY);
    await hit("2026-10-28", "labs.zh.xml", "1.1.1.2", FEEDLY.replace("16", "18"));
    await hit("2026-10-28", "labs.zh.xml", "2.2.2.2", NNW);
    await hit("2026-10-28", "labs.zh.xml", "2.2.2.2", NNW);
    await hit("2026-10-28", "labs.orig.xml", "3.3.3.3", INOREADER);
    await hit("2026-10-20", "labs.zh.xml", "4.4.4.4", NNW);

    const s = await feedStats(db, "2026-10-22", "2026-10-29");
    expect(s.feeds.get("labs.zh.xml")).toMatchObject({ readers: 19, hits: 4 });
    expect(s.feeds.get("labs.orig.xml")).toMatchObject({ readers: 9, hits: 1 });
    expect(s.readers).toBe(28);
    expect(s.clients[0]).toEqual({ client: "Feedly", readers: 18, aggregator: true });
    expect(s.since).toBe("2026-10-20");
  });
});
