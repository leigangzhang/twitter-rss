import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseXGraphQL } from "../src/parsers/x-graphql.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "user-tweets.json"), "utf8"));
const liveFixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "user-originals-live.json"), "utf8"));

describe("parseXGraphQL", () => {
  const { tweets, skipped } = parseXGraphQL([fixture], "mirachen_ml");
  const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));

  it("跳过广告，Thread 后续部分合并进开头那条", () => {
    expect(skipped).toEqual([]);
    expect(tweets.map((t) => t.id)).toEqual(["1900000000000000003", "1900000000000000002", "1900000000000000001"]);
  });

  it("长推文取全文，媒体链接去掉，t.co 还原", () => {
    const t = byId["1900000000000000003"]!;
    expect(t.text).toBe("Full long text that is longer than 280 characters would be here. Read more: https://www.example.org/study");
    expect(t.author).toEqual({ handle: "mirachen_ml", name: "Mira Chen", avatarUrl: "https://pbs.twimg.com/profile_images/1/a_bigger.jpg" });
    expect(t.createdAt).toBe("2026-10-18T01:12:00.000Z");
    expect(t.metrics).toMatchObject({ likes: 23000, reposts: 3104, quotes: 88, views: 120345 });
    expect(t.media).toEqual([{ type: "video", url: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg", width: 1280, height: 720, durationSec: 408 }]);
    expect(t.links[0]).toMatchObject({ expandedUrl: "https://www.example.org/study", title: "Long context study", domain: "example.org" });
    expect(t.thread).toEqual([{ id: "1900000000000000004", text: "Second part of the thread & more.", media: [] }]);
    expect(t.isReply).toBe(false);
  });

  it("展开引用推文，正文去掉引用链接", () => {
    const t = byId["1900000000000000002"]!;
    expect(t.text).toBe("Worth reading.");
    expect(t.links).toEqual([]);
    expect(t.quoted).toMatchObject({ id: "1800000000000000001", author: { handle: "theopark" }, text: "Quoted original text" });
  });

  it("标记纯转发", () => {
    expect(byId["1900000000000000001"]!.isRepost).toBe(true);
  });
});

describe("parseXGraphQL 真实 UserOriginalsTimeline 结构", () => {
  // 结构取自 Browser Skill 抓取到的真实响应，账号、正文、URL 和指标均已脱敏。
  const { tweets, skipped } = parseXGraphQL([liveFixture], "fixture_author");

  it("从时间线 envelope 中提取推文并合并作者自己的连续回复", () => {
    expect(skipped).toEqual([]);
    expect(tweets).toHaveLength(1);
    expect(tweets[0]).toMatchObject({
      id: "1900000000000000100",
      text: "Live timeline payload parsed correctly. Read more:",
      author: { handle: "fixture_author", name: "Fixture Author", avatarUrl: "https://example.com/avatar_bigger.jpg" },
      metrics: { likes: 42, reposts: 5, replies: 4, quotes: 3, bookmarks: 12, views: 1234 },
      thread: [{ id: "1900000000000000103", text: "Second fixture part.", media: [] }],
    });
  });

  it("保留真实响应里的媒体、链接和引用推文", () => {
    const t = tweets[0]!;
    expect(t.media).toEqual([
      { type: "photo", url: "https://example.com/photo.jpg", width: 1200, height: 800, altText: "Example diagram" },
    ]);
    expect(t.links).toEqual([{ url: "https://t.co/live1", expandedUrl: "https://example.org/live", domain: "example.org" }]);
    expect(t.quoted).toMatchObject({
      id: "1800000000000000100",
      author: { handle: "quoted_author", name: "Quoted Author" },
      text: "Quoted fixture text.",
    });
  });
});
