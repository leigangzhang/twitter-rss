import { describe, expect, it } from "vitest";
import { accountWeight, compactNumber, finalScore, mediaKind, median, passesFilters, RawTweet, ruleScore } from "../src/index.ts";

const base = RawTweet.parse({
  id: "1",
  url: "https://x.com/a/status/1",
  author: { handle: "Someone", name: "Someone" },
  createdAt: "2026-10-18T01:00:00Z",
  text: "A reasonably long tweet with enough substance to keep.",
  metrics: { likes: 100, reposts: 10, replies: 4 },
});

const filters = { include_replies: false, include_reposts: false, min_text_length: 20, min_quality: 5 };
const weights = { text: 1, image: 1, video: 0.6 };

describe("scoring", () => {
  it("账号统一转小写，缺省字段有默认值", () => {
    expect(base.author.handle).toBe("someone");
    expect(base.media).toEqual([]);
    expect(base.metrics.quotes).toBe(0);
  });

  it("识别媒体类型", () => {
    expect(mediaKind(base)).toBe("text");
    expect(mediaKind({ media: [{ type: "photo", url: "https://a.b/c.jpg" }] })).toBe("image");
    expect(mediaKind({ media: [{ type: "photo", url: "https://a.b/c.jpg" }, { type: "video", url: "https://a.b/v.jpg" }] })).toBe("video");
  });

  it("规则分以作者自身中位数为基准，4 倍记满分", () => {
    expect(ruleScore(base, 122)).toBeCloseTo(Math.log1p(1) / Math.log1p(4));
    expect(ruleScore(base, 10)).toBe(1);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("过滤回复、转发和过短内容", () => {
    expect(passesFilters(base, filters)).toEqual({ ok: true });
    expect(passesFilters({ ...base, isReply: true }, filters)).toEqual({ ok: false, reason: "回复" });
    expect(passesFilters({ ...base, text: "gm https://t.co/abc" }, filters)).toEqual({ ok: false, reason: "正文过短" });
    expect(passesFilters({ ...base, text: "look", media: [{ type: "photo", url: "https://a.b/c.jpg" }] }, filters).ok).toBe(true);
  });

  it("视频降权", () => {
    expect(finalScore(8, 0.5, "video", weights)).toBeCloseTo(finalScore(8, 0.5, "text", weights) * 0.6);
  });

  it("账号降权：不区分大小写，没设置的为 1", () => {
    const w = { JinchenMa_AI: 0.6 };
    expect(accountWeight(w, "jinchenma_ai")).toBe(0.6);
    expect(accountWeight(w, "sama")).toBe(1);
    expect(finalScore(4, 0.5, "text", weights, 0.6)).toBeCloseTo(finalScore(4, 0.5, "text", weights) * 0.6);
  });

  it("数字缩写", () => {
    expect(compactNumber(3104)).toBe("3,104");
    expect(compactNumber(23_000)).toBe("2.3万");
    expect(compactNumber(110_000)).toBe("11万");
  });
});

describe("qualityOf", () => {
  it("5 分制原样返回，旧的 10 分制折半", async () => {
    const { qualityOf } = await import("../src/types.ts");
    expect(qualityOf({ quality: 4, scale: 5 })).toBe(4);
    expect(qualityOf({ quality: 7 })).toBe(3.5);
    expect(qualityOf({ quality: 5.9 })).toBe(3);
    expect(qualityOf(null)).toBe(0);
  });
});
