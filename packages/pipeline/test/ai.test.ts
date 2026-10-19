import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RawTweet } from "@xrss/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlmEditor, createLlmReviewer, editorSystemPrompt, normalizeReview, reviewSystemPrompt } from "../src/ai.ts";

// 用本地假服务模拟 DeepSeek 的 Anthropic 兼容接口，检查请求内容和结果解析
const requests: Array<{ path: string; auth: string | undefined; body: any }> = [];
let rejectImages = false;
let editorialReply: unknown = { drops: [] };
let server: Server;
let baseURL = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = JSON.parse(data);
      requests.push({ path: req.url!, auth: req.headers["x-api-key"] as string | undefined, body });
      const content = body.messages[0].content;
      const hasImage = Array.isArray(content) && content.some((b: any) => b.type === "image");
      if (rejectImages && hasImage) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "image not supported" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (body.tool_choice?.name === "submit_editorial") {
        res.end(
          JSON.stringify({
            id: "msg_2",
            type: "message",
            role: "assistant",
            model: body.model,
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: "tool_use", id: "tu_2", name: "submit_editorial", input: editorialReply }],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body.model,
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "submit_review",
              input: {
                verdict: "keep",
                category: "best_practice",
                dropReason: null,
                quality: 4,
                topicId: "unknown",
                summary: "一条示例",
                reason: "一手经验",
                zh: { text: "你好", thread: [], quotedText: null, linkTitle: null, linkDescription: null },
                mediaNote: null,
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const tweet = RawTweet.parse({
  id: "1",
  url: "https://x.com/a/status/1",
  author: { handle: "a", name: "A" },
  createdAt: "2026-10-18T01:00:00Z",
  lang: "en",
  text: "hello",
  metrics: { likes: 1, reposts: 0, replies: 0 },
  media: [{ type: "photo", url: "https://example.com/p.jpg" }],
});

describe("createLlmReviewer（DeepSeek Anthropic 兼容接口）", () => {
  it("按 deepseek-flash 发请求、强制调用评审工具，并修正不在候选里的主题", async () => {
    requests.length = 0;
    const reviewer = createLlmReviewer({ apiKey: "sk-test", baseURL, guide: "只要最佳实践" });
    const result = await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    expect(result).toMatchObject({
      verdict: "keep",
      category: "best_practice",
      quality: 4,
      scale: 5,
      topicId: "ai",
      zh: { text: "你好", quotedText: null, linkTitle: null, linkDescription: null },
    });
    expect(requests[0]!.body.system).toContain("只要最佳实践");
    expect(requests[0]).toMatchObject({ path: "/v1/messages", auth: "sk-test" });
    expect(requests[0]!.body).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "submit_review" },
    });
    expect(requests[0]!.body.messages[0].content[0]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/p.jpg" } });
  });

  it("图片请求失败时退回纯文字评审", async () => {
    requests.length = 0;
    rejectImages = true;
    const reviewer = createLlmReviewer({ apiKey: "sk-test", baseURL });
    const result = await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    rejectImages = false;
    expect(result).toMatchObject({ quality: 4, scale: 5 });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body.messages[0].content.every((b: any) => b.type === "text")).toBe(true);
  });

  it("没有 DEEPSEEK_API_KEY 时给出明确提示", () => {
    expect(() => createLlmReviewer({ apiKey: "" })).toThrow("DEEPSEEK_API_KEY");
  });
});

describe("精选规则", () => {
  const base = {
    verdict: "keep" as const,
    category: "expert_insight" as const,
    dropReason: null,
    quality: 4,
    topicId: "ai",
    summary: "s",
    reason: "r",
    zh: null,
    mediaNote: null,
  };

  it("提示词包含 config/curation.md 的内容，缺省时使用内置标准", () => {
    expect(reviewSystemPrompt("自定义标准 XYZ")).toContain("自定义标准 XYZ");
    expect(reviewSystemPrompt("")).toContain("best_practice");
    expect(editorSystemPrompt("")).toContain("same_event");
  });

  it("类型为 other 时强制剔除，剔除的内容不超过 2 分、保留的至少 3 分（5 分制）", () => {
    expect(normalizeReview({ ...base, category: "other" }, tweet, [{ id: "ai" }])).toMatchObject({ verdict: "drop", dropReason: "other", quality: 2, scale: 5 });
    expect(normalizeReview({ ...base, verdict: "drop", dropReason: "preachy", quality: 4 }, tweet, [{ id: "ai" }])).toMatchObject({ quality: 2 });
    // 保留的至少 3 分
    expect(normalizeReview({ ...base, quality: 1 }, tweet, [{ id: "ai" }])).toMatchObject({ verdict: "keep", quality: 3 });
    expect(normalizeReview({ ...base, category: "showcase" }, tweet, [{ id: "ai" }])).toMatchObject({ verdict: "keep", quality: 4 });
    expect(normalizeReview({ ...base, dropReason: "shallow" }, tweet, [{ id: "ai" }]).dropReason).toBeNull();
  });

  it("终审只剔除今天候选里的推文，不会把保留的那条也剔除", async () => {
    editorialReply = {
      drops: [
        { id: "b", reason: "same_event", keptId: "a", note: "同一发布" },
        { id: "x", reason: "duplicate", keptId: "a", note: "不在候选里" },
        { id: "a", reason: "duplicate", keptId: "a", note: "自相矛盾" },
      ],
    };
    const editor = createLlmEditor({ apiKey: "sk-test", baseURL });
    const item = (id: string) => ({ id, author: "@a", topicId: "ai", category: "industry_trend" as const, quality: 7, summary: id });
    const result = await editor.edit([item("a"), item("b")], []);
    expect(result.drops.map((d) => d.id)).toEqual(["b"]);
    expect(requests.at(-1)!.body).toMatchObject({
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "submit_editorial" },
    });
  });
});

describe("引用推文摘要", () => {
  const base = { verdict: "keep" as const, category: "best_practice" as const, dropReason: null, quality: 4, topicId: "ai", summary: "s", reason: "r", zh: null, mediaNote: null };
  const digest = { summary: "概括", points: ["要点一", "要点二"] };
  const withQuote = (text: string) =>
    RawTweet.parse({
      id: "1",
      url: "https://x.com/a/status/1",
      author: { handle: "a", name: "A" },
      createdAt: "2026-10-18T03:00:00Z",
      lang: "zh",
      text: "看看这个",
      metrics: { likes: 1, reposts: 0, replies: 0 },
      quoted: { id: "2", url: "https://x.com/b/status/2", author: { handle: "b", name: "B" }, text },
    });

  it("短而完整的引用不需要摘要，长的或被截断的保留摘要", () => {
    expect(normalizeReview({ ...base, quotedDigest: digest }, withQuote("一句完整的话。"), [{ id: "ai" }]).quotedDigest).toBeNull();
    expect(normalizeReview({ ...base, quotedDigest: digest }, withQuote("其实整体还挺耐用的，但是需要对默认设置稍微做点调整："), [{ id: "ai" }]).quotedDigest).toEqual(digest);
    expect(normalizeReview({ ...base, quotedDigest: digest }, withQuote("长".repeat(200) + "。"), [{ id: "ai" }]).quotedDigest).toEqual(digest);
  });
});
