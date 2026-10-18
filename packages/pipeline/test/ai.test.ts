import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RawTweet } from "@xrss/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlmReviewer } from "../src/ai.ts";

// 用本地假服务模拟 DeepSeek 的 Anthropic 兼容接口，检查请求内容和结果解析
const requests: Array<{ path: string; auth: string | undefined; body: any }> = [];
let rejectImages = false;
let server: Server;
let baseURL = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = JSON.parse(data);
      requests.push({ path: req.url!, auth: req.headers["x-api-key"] as string | undefined, body });
      const hasImage = body.messages[0].content.some((b: any) => b.type === "image");
      if (rejectImages && hasImage) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "image not supported" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
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
              input: { quality: 8, topicId: "unknown", reason: "一手经验", zh: { text: "你好", thread: [] }, mediaNote: null },
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
    const reviewer = createLlmReviewer({ apiKey: "sk-test", baseURL });
    const result = await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    expect(result).toMatchObject({ quality: 8, topicId: "ai", zh: { text: "你好" } });
    expect(requests[0]).toMatchObject({ path: "/v1/messages", auth: "sk-test" });
    expect(requests[0]!.body).toMatchObject({ model: "deepseek-flash", tool_choice: { type: "tool", name: "submit_review" } });
    expect(requests[0]!.body.messages[0].content[0]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/p.jpg" } });
  });

  it("图片请求失败时退回纯文字评审", async () => {
    requests.length = 0;
    rejectImages = true;
    const reviewer = createLlmReviewer({ apiKey: "sk-test", baseURL });
    const result = await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    rejectImages = false;
    expect(result.quality).toBe(8);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body.messages[0].content.every((b: any) => b.type === "text")).toBe(true);
  });

  it("没有 DEEPSEEK_API_KEY 时给出明确提示", () => {
    expect(() => createLlmReviewer({ apiKey: "" })).toThrow("DEEPSEEK_API_KEY");
  });
});
