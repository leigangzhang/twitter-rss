import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { RawTweet } from "@xrss/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlmEditor, createLlmReviewer, describeLlm, editorSystemPrompt, llmSettings, normalizeReview, reviewSystemPrompt, unwrapToolInput } from "../src/ai.ts";

// 用本地假服务模拟 DeepSeek 的 Anthropic 兼容接口，检查请求内容和结果解析
const requests: Array<{ path: string; auth: string | undefined; body: any }> = [];
let rejectImages = false;
let editorialReply: unknown = { drops: [] };
// 下一次评审请求模拟"输出达到上限被截断"
let truncateNext = false;
// 覆盖评审结果里的字段
let reviewPatch: Record<string, unknown> = {};
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
      if (truncateNext) {
        truncateNext = false;
        res.end(
          JSON.stringify({
            id: "msg_t",
            type: "message",
            role: "assistant",
            model: body.model,
            stop_reason: "max_tokens",
            usage: { input_tokens: 10, output_tokens: body.max_tokens },
            content: [{ type: "tool_use", id: "tu_t", name: "submit_review", input: {} }],
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
                ...reviewPatch,
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
    // 图片不送给模型识别
    expect(JSON.stringify(requests[0]!.body.messages)).not.toContain("p.jpg");
  });

  it("图片和视频封面都不送给模型，mediaNote 一律为空", async () => {
    requests.length = 0;
    const withVideo = { ...tweet, media: [{ type: "video" as const, url: "https://example.com/cover.jpg" }] };
    const result = await createLlmReviewer({ apiKey: "sk-test", baseURL }).review(withVideo, [{ id: "ai", name: "AI" }]);
    expect(JSON.stringify(requests[0]!.body.messages)).not.toContain("cover.jpg");
    expect(typeof requests[0]!.body.messages[0].content).toBe("string");
    expect(result.mediaNote).toBeNull();
  });

  it("输出被截断时调高上限重试；keep 时剔除原因填了无效值不算失败", async () => {
    requests.length = 0;
    truncateNext = true;
    reviewPatch = { dropReason: "" };
    const result = await createLlmReviewer({ apiKey: "sk-test", baseURL }).review(tweet, [{ id: "ai", name: "AI" }]);
    reviewPatch = {};
    expect(result).toMatchObject({ verdict: "keep", dropReason: null, quality: 4 });
    expect(requests.map((r) => r.body.max_tokens)).toEqual([6000, 8000]);
  });

  it("没有 API Key 时给出明确提示", () => {
    expect(() => createLlmReviewer({ apiKey: "" })).toThrow("LLM_API_KEY");
  });

  it("端点、模型、密钥可以在 .env 里自定义，旧名 DEEPSEEK_API_KEY 仍然有效", () => {
    const keep = { ...process.env };
    try {
      for (const k of ["LLM_API", "LLM_API_KEY", "DEEPSEEK_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) delete process.env[k];
      expect(llmSettings()).toEqual({ api: "anthropic", apiKey: undefined, baseURL: "https://api.deepseek.com/anthropic", model: "deepseek-flash" });
      process.env.DEEPSEEK_API_KEY = "sk-old";
      expect(llmSettings().apiKey).toBe("sk-old");
      process.env.LLM_API_KEY = "sk-new";
      process.env.LLM_BASE_URL = "https://api.example.com/anthropic/v1/";
      process.env.LLM_MODEL = "some-model";
      expect(llmSettings()).toEqual({ api: "anthropic", apiKey: "sk-new", baseURL: "https://api.example.com/anthropic", model: "some-model" });
      expect(describeLlm()).toBe("some-model @ api.example.com/anthropic（Anthropic 接口）");
      process.env.LLM_API = "OpenAI";
      process.env.LLM_BASE_URL = "https://api.example.com/v1/chat/completions";
      expect(llmSettings()).toMatchObject({ api: "openai", baseURL: "https://api.example.com/v1" });
      process.env.LLM_BASE_URL = "https://api.example.com/";
      expect(llmSettings().baseURL).toBe("https://api.example.com/v1");
      process.env.LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
      expect(llmSettings().baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
      delete process.env.LLM_BASE_URL;
      expect(llmSettings().baseURL).toBe("https://api.openai.com/v1");
      process.env.LLM_API = "gemini";
      expect(() => llmSettings()).toThrow("LLM_API");
      delete process.env.LLM_API;
      expect(llmSettings({ model: "override" }).model).toBe("override");
    } finally {
      process.env = keep;
    }
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

  it("阅读摘要只留给中文版显示超过 300 字的推文（含 Thread），短的清空", () => {
    const withSummary = { ...base, readerSummary: { lead: " 显存用没用上，速度差三倍 ", points: ["a", " ", "b", "c", "d"] } };
    const short = normalizeReview(withSummary, tweet, [{ id: "ai" }]);
    expect(short.readerSummary).toBeNull();
    const long = normalizeReview(withSummary, { ...tweet, text: "word ".repeat(120) }, [{ id: "ai" }]);
    // 去掉空要点，最多 3 条
    expect(long.readerSummary).toEqual({ lead: "显存用没用上，速度差三倍", points: ["a", "b", "c"] });
    // 短 Thread 不再单独给摘要；长 Thread 按总字数
    const shortThread = normalizeReview(withSummary, { ...tweet, thread: [{ id: "2", text: "more" }] } as typeof tweet, [{ id: "ai" }]);
    expect(shortThread.readerSummary).toBeNull();
    const longThread = normalizeReview(withSummary, { ...tweet, thread: [{ id: "2", text: "more ".repeat(70) }] } as typeof tweet, [{ id: "ai" }]);
    expect(longThread.readerSummary).toMatchObject({ lead: "显存用没用上，速度差三倍" });
    // 外文原文长、但翻译成中文后不到 300 字：邮件里不显示摘要，也就不保留
    const translatedShort = normalizeReview({ ...withSummary, zh: { text: "中".repeat(200), thread: [] } }, { ...tweet, text: "word ".repeat(120) }, [{ id: "ai" }]);
    expect(translatedShort.readerSummary).toBeNull();
    expect(reviewSystemPrompt("")).toContain("40 字以内");
  });

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

// OpenAI Chat Completions 格式：模拟一个只接受 max_completion_tokens、不接受 temperature 的服务
describe("OpenAI 兼容接口", () => {
  const calls: Array<{ path: string; auth: string | undefined; body: any }> = [];
  let oaServer: Server;
  let oaURL = "";
  let mode: "strict" | "content" = "strict";

  beforeAll(async () => {
    oaServer = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data);
        calls.push({ path: req.url!, auth: req.headers.authorization, body });
        const fail = (message: string) => {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message, type: "invalid_request_error" } }));
        };
        if (mode === "strict" && "max_tokens" in body) return fail("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.");
        if (mode === "strict" && "temperature" in body) return fail("Unsupported value: 'temperature' does not support 0.2 with this model.");
        const name = body.tools[0].function.name;
        const args =
          name === "submit_editorial"
            ? { drops: [] }
            : {
                verdict: "keep",
                category: "new_release",
                dropReason: null,
                quality: 5,
                topicId: "ai",
                summary: "示例",
                reason: "新发布",
                zh: null,
                mediaNote: null,
              };
        const message =
          mode === "content"
            ? { role: "assistant", content: "```json\n" + JSON.stringify(args) + "\n```" }
            : { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message, finish_reason: "tool_calls" }] }));
      });
    });
    await new Promise<void>((r) => oaServer.listen(0, "127.0.0.1", r));
    oaURL = `http://127.0.0.1:${(oaServer.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => oaServer.close());

  it("发 Chat Completions 请求，遇到参数报错自动调整并记住", async () => {
    calls.length = 0;
    mode = "strict";
    const reviewer = createLlmReviewer({ api: "openai", apiKey: "sk-oa", baseURL: oaURL, model: "gpt-x" });
    const result = await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    expect(result).toMatchObject({ verdict: "keep", category: "new_release", quality: 5 });
    expect(calls).toHaveLength(3);
    const last = calls[2]!;
    expect(last).toMatchObject({ path: "/v1/chat/completions", auth: "Bearer sk-oa" });
    expect(last.body).toMatchObject({
      model: "gpt-x",
      max_completion_tokens: 6000,
      tool_choice: { type: "function", function: { name: "submit_review" } },
    });
    expect(last.body).not.toHaveProperty("temperature");
    expect(last.body.messages[0]).toMatchObject({ role: "system" });
    expect(last.body.messages[1].content).toEqual(expect.any(String));

    // 同一个客户端的下一次请求直接用调整后的参数
    calls.length = 0;
    await reviewer.review(tweet, [{ id: "ai", name: "AI" }]);
    expect(calls).toHaveLength(1);
  });

  it("模型把 JSON 写在正文里时也能解析", async () => {
    calls.length = 0;
    mode = "content";
    const editor = createLlmEditor({ api: "openai", apiKey: "sk-oa", baseURL: oaURL, model: "gpt-x" });
    const result = await editor.edit(
      [
        { id: "1", handle: "a", topicId: "ai", summary: "x", quality: 4 },
        { id: "2", handle: "b", topicId: "ai", summary: "y", quality: 4 },
      ] as any,
      [],
    );
    expect(result).toEqual({ drops: [] });
    expect(calls[0]!.body).toMatchObject({ max_tokens: 4000, temperature: 0 });
  });
});

describe("工具参数被多包了一层", () => {
  it("拆开 {input: {...}}、JSON 字符串和多层包装；正常结果原样返回", () => {
    const ok = { verdict: "keep", quality: 4 };
    expect(unwrapToolInput(ok, "verdict")).toBe(ok);
    expect(unwrapToolInput({ input: ok }, "verdict")).toEqual(ok);
    expect(unwrapToolInput({ parameters: JSON.stringify(ok) }, "verdict")).toEqual(ok);
    expect(unwrapToolInput(JSON.stringify({ review: ok }), "verdict")).toEqual(ok);
    // 看不出包装（多个字段）时不动
    const other = { a: 1, b: 2 };
    expect(unwrapToolInput(other, "verdict")).toBe(other);
  });
});
