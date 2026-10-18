import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseXGraphQL } from "../src/parsers/x-graphql.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "user-tweets.json"), "utf8"));

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
