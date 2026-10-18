import type { TimeRange } from "@xrss/core";
import type { TweetRow } from "@xrss/core/db";
import { describe, expect, it } from "vitest";
import { renderCurationReport } from "../src/editorial.ts";

describe("精选报告", () => {
  it("旧 --skip-ai 的 ai 对象缺少 summary/reason 时仍能生成报告", () => {
    const row = {
      id: "1",
      handle: "a",
      createdAt: new Date("2026-10-17T03:00:00Z"),
      kind: "text",
      raw: {
        id: "1",
        url: "https://x.com/a/status/1",
        author: { handle: "a", name: "A" },
        createdAt: "2026-10-17T03:00:00Z",
        text: "规则评审留下的正文",
        metrics: { likes: 0, reposts: 0, replies: 0 },
        media: [],
        links: [],
        thread: [],
      },
      engagement: 0,
      status: "scored",
      filterReason: null,
      ruleScore: 0.5,
      ai: { quality: 5.6, topicId: "ai", category: "other" },
      topicId: "ai",
      finalScore: 0.5,
      collectedAt: new Date("2026-10-18T00:00:00Z"),
      processedAt: new Date("2026-10-18T00:00:00Z"),
    } as unknown as TweetRow;
    const range: TimeRange = {
      since: new Date("2026-10-16T16:00:00Z"),
      until: new Date("2026-10-17T16:00:00Z"),
      contentDate: "2026-10-17",
    };

    const md = renderCurationReport([row], range, "2026-10-18");

    expect(md).toContain("规则评审留下的正文");
    expect(md).toContain("未记录理由");
    expect(md).toContain("通过 1");
  });
});
