import { describe, expect, it } from "vitest";
import { RawTweet } from "../src/types.ts";
import { toCardView } from "../src/view.ts";

const opts = { lang: "zh" as const, timezone: "Asia/Shanghai", videoMode: "thumbnail" as const, maxThreadParts: 8, now: new Date("2026-10-20T00:00:00Z") };

function tweetWithLink(link: Record<string, unknown>) {
  return RawTweet.parse({
    id: "1",
    url: "https://x.com/a/status/1",
    author: { handle: "a", name: "A" },
    createdAt: "2026-10-19T01:00:00Z",
    lang: "en",
    text: "MiniMax M3.1 Flash is live: https://platform.minimax.io",
    metrics: { likes: 1, reposts: 0, replies: 0 },
    links: [{ kind: "web", url: "https://t.co/x", expandedUrl: "https://platform.minimax.io", domain: "platform.minimax.io", ...link }],
  });
}

describe("链接展示", () => {
  it("抓不到正文、没有简介时不做成文章卡片；标题只是网址时也不重复显示链接", () => {
    const card = toCardView({ id: "1", topicId: "ai", kind: "text", raw: tweetWithLink({ title: "http://platform.minimax.io" }), ai: null }, opts);
    expect(card.article).toBeUndefined();
    expect(card.link?.title).toBeUndefined();
  });

  it("有简介或 AI 概要时照常显示文章卡片", () => {
    const card = toCardView(
      {
        id: "1",
        topicId: "ai",
        kind: "text",
        raw: tweetWithLink({ title: "MiniMax Platform" }),
        ai: null,
        article: { url: "https://platform.minimax.io", status: "ok", fetched: true, title: "MiniMax Platform", summary: "开放平台提供 M3.1 系列模型的 API。", points: ["每百万 token 输入 0.15 美元"] } as never,
      },
      opts,
    );
    expect(card.article).toMatchObject({ title: "MiniMax Platform", summary: "开放平台提供 M3.1 系列模型的 API。" });
  });

  it("旧数据的阅读摘要是一段文字时，当作结论、没有要点", () => {
    const raw = tweetWithLink({ title: "x" });
    const ai = { verdict: "keep", category: "expert_insight", dropReason: null, quality: 4, scale: 5, topicId: "ai", summary: "s", reason: "r", zh: null, mediaNote: null, readerSummary: "一段旧摘要" } as const;
    const card = toCardView({ id: "1", topicId: "ai", kind: "text", raw, ai: ai as never }, opts);
    expect(card.readerSummary).toEqual({ lead: "一段旧摘要", points: [] });
  });

  it("原文版用推文原来语言的阅读摘要和引用摘要；原文是中文时两版共用中文摘要", () => {
    const raw = RawTweet.parse({
      ...tweetWithLink({ title: "x" }),
      quoted: { id: "2", url: "https://x.com/b/status/2", author: { handle: "b", name: "B" }, text: "Quoted original text", links: [], media: [] },
    });
    const ai = {
      verdict: "keep", category: "expert_insight", dropReason: null, quality: 4, scale: 5, topicId: "ai", summary: "一句话", reason: "r",
      zh: { text: "译文", thread: [], quotedText: "引用译文" }, mediaNote: null,
      readerSummary: { lead: "结论", points: ["要点"] },
      quotedDigest: { summary: "引用摘要", points: ["引用要点"] },
      orig: { readerSummary: { lead: "Conclusion", points: ["Point"] }, quotedDigest: { summary: "Quote digest", points: ["Quote point"] } },
    };
    const card = (lang: "zh" | "orig", r = raw, a: object = ai) => toCardView({ id: "1", topicId: "ai", kind: "text", raw: r, ai: a as never }, { ...opts, lang });
    expect(card("zh").readerSummary).toEqual({ lead: "结论", points: ["要点"] });
    expect(card("zh").quoted).toMatchObject({ summary: "引用摘要", text: "引用译文" });
    const orig = card("orig");
    expect(orig.readerSummary).toEqual({ lead: "Conclusion", points: ["Point"] });
    expect(orig.quoted).toMatchObject({ summary: "Quote digest", points: ["Quote point"], text: "Quoted original text" });
    expect(orig.summary).toBeUndefined();
    // 旧数据没有原文版摘要：原文版不显示中文摘要
    expect(card("orig", raw, { ...ai, orig: undefined }).readerSummary).toBeUndefined();
    // 中文推文
    const zhRaw = RawTweet.parse({ ...raw, lang: "zh" });
    expect(card("orig", zhRaw, { ...ai, zh: null, orig: null }).readerSummary).toEqual({ lead: "结论", points: ["要点"] });
  });

  it("标题：中文版用中文标题，原文版用推文语言的标题，中文推文两版共用", () => {
    const raw = tweetWithLink({ title: "x" });
    const ai = {
      verdict: "keep", category: "new_release", dropReason: null, quality: 4, scale: 5, topicId: "ai", summary: "一句话", reason: "r",
      zh: null, mediaNote: null, title: "MiniMax 上线 M3.1 Flash", orig: { title: "MiniMax launches M3.1 Flash" },
    };
    const card = (lang: "zh" | "orig", r = raw, a: object = ai) => toCardView({ id: "1", topicId: "ai", kind: "text", raw: r, ai: a as never }, { ...opts, lang });
    expect(card("zh").title).toBe("MiniMax 上线 M3.1 Flash");
    expect(card("orig").title).toBe("MiniMax launches M3.1 Flash");
    // 旧数据没有标题
    expect(card("orig", raw, { ...ai, title: undefined, orig: null }).title).toBeUndefined();
    const zhRaw = RawTweet.parse({ ...raw, lang: "zh" });
    expect(card("orig", zhRaw, { ...ai, orig: null }).title).toBe("MiniMax 上线 M3.1 Flash");
  });
});
