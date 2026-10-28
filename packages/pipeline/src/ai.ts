import Anthropic from "@anthropic-ai/sdk";
import { AiResult, cleanTweetText, displayTextLength, READER_SUMMARY_MIN_CHARS, ReaderSummary, type ContentCategory, type LinkDigest, looksTruncated, type RawTweet, type Topic, xWeightedLength } from "@xrss/core";
import { z } from "zod";

/** DeepSeek 的 Anthropic 兼容接口：https://api-docs.deepseek.com/guides/anthropic_api */
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

/** config/curation.md 缺失时使用的精选标准（与仓库里的默认文件一致的精简版） */
const DEFAULT_GUIDE = `## 读者
有一定技术背景的产品、研发和 AI 爱好者，大多不是大模型研究者。
## 要保留的内容
- best_practice 最佳实践与用法：读者能照着试的做法，有一两个具体细节即可。
- real_problem 真实世界问题：一线的实际问题、事故复盘、带数据的观察。
- new_release 新发布与新能力：新模型、产品、功能、开源项目，说清能做什么、有什么不同。
- showcase 应用案例与灵感：用 AI 做出的真实作品和新用法。
- industry_trend 行业趋势与解读：事件 + 一点解读或背景。
- expert_insight 专家思考：有理由的原创判断和洞察。
## 要剔除
preachy 说教、obvious 显而易见、shallow 没有思考、repost 纯搬运、duplicate 重复、promo 推广、chitchat 闲聊。
有用或有启发就保留，拿不准时有具体信息的保留打 3 分；读得懂比专业更重要。
## 打分（5 分制）
5 必读，4 值得读，3 有收获（保留最低分），2 价值低，1 不推荐。`;

/** 第一步：逐条评审 */
export function reviewSystemPrompt(guide: string): string {
  return `你是一份 X（原 Twitter）每日精选邮件的资深编辑，为读者挑出对他们有用、有启发的内容。读者是中文用户，希望不打开 X 就能读懂每条推文。

下面是这份邮件的精选标准，请按它判断：

<curation_guide>
${guide || DEFAULT_GUIDE}
</curation_guide>

对给你的这条推文，按顺序完成：
1. 先判断它是什么类型（category）：best_practice / real_problem / new_release / showcase / industry_trend / expert_insight，
   都不是则为 other。看实质内容而不是话题：讲 AI 的空话仍然是 other。
2. 再判断去留（verdict）：属于上面六类之一、对读者有用或有启发就 keep；否则 drop，并在 dropReason 里选最主要的原因
   （preachy / obvious / shallow / repost / duplicate / promo / chitchat / other）。keep 时 dropReason 为 null。
   category 为 other 时 verdict 必须是 drop。
3. 打质量分 quality：1–5 的整数（5 分制），按标准里的打分说明。keep 的至少 3 分，drop 的不超过 2 分。
4. 从给定的候选主题里选一个最贴近的 topicId。
5. summary：用一句 30–60 字的中文概括这条推文讲了什么（事实 + 观点），后面会用它判断不同推文是否重复。
6. reason：用一句中文说明你的判断理由，指出它属于哪类、具体价值在哪里，或者为什么剔除。
7. 如果原文不是中文，把正文、Thread 后续部分、引用推文、链接标题和简介翻译成自然流畅的简体中文，填进 zh；
   保留专有名词、代码、数字和 @账号，不添加原文没有的内容。原文已是中文时 zh 为 null。drop 的内容也要照常翻译。
8. mediaNote 一律填 null（图片和视频都不需要说明）。
9. 引用推文（quoted）较长（超过约 140 个汉字或 280 个英文字符），或 quoted.truncated 为 true（时间线只给了前一部分）时，
   填 quotedDigest：summary 用 1–2 句中文说清它讲了什么、结论是什么，points 列 2–4 条具体要点（做法、数据、名称），
   要求和下面 readerSummary 的写法相同；被截断时只概括能看到的部分，不要猜测或补全没看到的内容。
   引用很短、或没有引用时 quotedDigest 为 null。
10. readerSummary：正文（含 Thread）在中文版里超过约 ${READER_SUMMARY_MIN_CHARS} 字时填写（原文是中文按原文字数，外文按你翻译后的中文字数），
   给没时间读原文的读者看，邮件里会先显示它、原文折叠。读者扫一眼 lead 就要知道这条讲什么、值不值得展开。
   - lead：一句简体中文，40 字以内，直接写核心结论或最重要的发现（有大胆预测或反主流观点时就写它）。
     不要照抄正文第一句或标题句，要把结论说得比原文开头更清楚；有引用推文时说清作者在回应什么。
   - points：0–3 条支撑 lead 的关键依据（数据、做法或步骤、前提条件、工具或产品名），每条一句、30 字以内，
     只保留最关键的 1–2 个数字；不要重复 lead；内容只有一个观点时 points 为空数组。
   - points 写内容本身，不写目录：不要写"还讨论了……""介绍了……的方法"，要写出讨论的结论或方法是什么。
   - 读者是做产品和研发的人，但不一定是这个领域的专家：每条要点最多一个专门术语（配置项、协议名、缩写、论文代号），
     并且要让人看得懂它是干什么的；原文里的缩写（如 RDF、SPARQL、EP/DP）能不写就不写，换成它起的作用。
     宁可少一条要点，也不要堆术语。
   - 禁止空话："作者认为……""作者分享了……""本文介绍了……""值得一读"。直接写观点和事实。
   - 只写原文（含引用和 Thread）里有的信息，不评价、不夸大、不补充原文没有的数字和名称；数字必须和原文完全一致。
     lead 加 points 合计不超过约 150 字。
   - 示例（好）：lead"本地跑 MoE 慢的真凶是专家权重反复读 SSD，关两个参数提速 8 倍"，
     points["每个 token 仍要从 SSD 读约 78 MB 专家数据", "关掉 --ssd-cache 和 --mmap-experts，让专家常驻内存"]
   - 示例（差）：lead"作者分享了本地部署大模型的性能优化经验"，points["介绍了问题的排查过程", "还讨论了参数设置"]
     ——没有结论、没有数字、只是目录。
   正文较短时 readerSummary 为 null。
11. orig：原文版邮件用的摘要。原文不是中文时，用推文原文的语言（lang 字段；lang 缺失或不明确时用正文实际使用的语言）
   再写一份 readerSummary 和 quotedDigest，填进 orig。填写条件、结构和全部写法要求与上面的中文版完全相同，内容与中文版对应：
   中文版为 null 的项，orig 里也为 null。篇幅按语言换算，英文时 lead 约 25 个单词以内、每条要点约 20 个单词以内、
   quotedDigest.summary 约 2 句；其他语言按相当的篇幅。原文已是中文时 orig 为 null。

linkedArticle 是推文（或引用推文）所附外部文章的标题、简介和正文开头（fetched 为 false 时只有标题和简介）。
推文主要是在分享这篇文章时，按文章本身的价值判断类型和去留：实践复盘、技术博客、研究报告等有实质内容的可以保留，
营销软文、空洞的新闻转述仍然剔除。summary 要概括推文和文章合起来讲了什么。

线程（thread）是作者本人的连续推文，与正文一起作为一个整体评审。引用推文（quoted）是作者在评论的对象：
作者只是转发并附一句"值得一读"时，价值主要来自被引用的内容，要看作者有没有增量。`;
}

/** 第二步：编辑终审（同一天的候选放在一起看） */
export function editorSystemPrompt(guide: string): string {
  return `你是一份 X（原 Twitter）每日精选邮件的主编。下面是今天已经通过初审的候选推文，每条都有类型、分数和一句话摘要。
初审已经判断过单条内容的价值，你的任务只有一个：去掉重复。

<curation_guide>
${guide || DEFAULT_GUIDE}
</curation_guide>

需要剔除的情况：
1. same_event：多条推文讲同一个事件、发布或新闻（即使来自不同作者）。只保留信息量最大、解读最深的一条。
2. duplicate：同一作者或不同作者表达了基本相同的观点或方法。只保留说得最清楚、最具体的一条。
   同一作者的连载（如分多条发布的书摘或系列文章）中，内容高度相似、彼此重复的部分也算重复；内容各有新意的不算。
3. repeat_recent：与"最近几天已发送"列表中的某条基本相同（同一事件且没有新进展，或同一观点）。

不要因为其他原因剔除（分数、类型都不是你这一步的判断依据），不要剔除内容不同的推文。
没有需要剔除的就返回空列表。每个剔除都要写明保留了哪一条（keptId，repeat_recent 时可为 null）和一句中文理由。`;
}

const REVIEW_TOOL = "submit_review";

/** 模型要填的评审结果：5 分制整数分，scale 由程序补上 */
export const ReviewOutput = AiResult.omit({ scale: true }).extend({
  quality: z.number().int().min(1).max(5).describe("5 分制：5 必读，4 值得读，3 有收获，2 价值低，1 不推荐"),
  // keep 时模型偶尔把剔除原因填成空字符串或"none"，这不影响结果，按"没有"处理（drop 时 normalizeReview 会补成 other）
  dropReason: AiResult.shape.dropReason.catch(null),
  // 模型只输出新格式（结论 + 要点）；字符串格式只在旧数据里出现
  readerSummary: ReaderSummary.nullish(),
});
const EDIT_TOOL = "submit_editorial";

export const EditorialResult = z.object({
  drops: z.array(
    z.object({
      id: z.string(),
      reason: z.enum(["same_event", "duplicate", "repeat_recent"]),
      keptId: z.string().nullable(),
      note: z.string(),
    }),
  ),
});
export type EditorialResult = z.infer<typeof EditorialResult>;

export interface EditorialItem {
  id: string;
  author: string;
  topicId: string;
  category: ContentCategory;
  quality: number;
  summary: string;
}

/** 推文里外部文章的内容，帮助判断"转发链接 + 一句话"这类推文的真实价值 */
function articlePayload(a: LinkDigest | undefined) {
  if (!a || a.status === "skipped") return undefined;
  return {
    site: a.siteName,
    title: a.title,
    description: a.description,
    // 正文开头 2000 字足够判断价值，控制成本
    excerpt: a.excerpt?.slice(0, 2000),
    fetched: a.status === "fetched",
  };
}

function tweetPayload(t: RawTweet, article?: LinkDigest) {
  return {
    author: `${t.author.name} (@${t.author.handle})`,
    lang: t.lang,
    text: cleanTweetText(t.text),
    textTruncated: t.textTruncated || undefined,
    thread: t.thread.map((p) => cleanTweetText(p.text)),
    quoted: t.quoted
      ? { author: `@${t.quoted.author.handle}`, text: cleanTweetText(t.quoted.text), truncated: looksTruncated(cleanTweetText(t.quoted.text)) || undefined }
      : undefined,
    links: t.links.map((l) => ({ kind: l.kind, url: l.expandedUrl, title: l.title, description: l.description })),
    media: t.media.map((m) => ({ type: m.type, durationSec: m.durationSec, altText: m.altText })),
    metrics: t.metrics,
    linkedArticle: articlePayload(article),
  };
}

export interface Reviewer {
  /** article：推文（或引用推文）里外部文章的抓取结果，可选 */
  review(tweet: RawTweet, topics: Pick<Topic, "id" | "name">[], article?: LinkDigest): Promise<AiResult>;
}

export interface Editor {
  edit(today: EditorialItem[], recent: Array<{ id: string; summary: string }>): Promise<EditorialResult>;
}

export type LlmApi = "anthropic" | "openai";

export interface LlmOptions {
  /** 接口格式：anthropic（Messages API）或 openai（Chat Completions），默认 anthropic */
  api?: LlmApi;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** config/curation.md 的内容 */
  guide?: string;
}

/** 默认模型（DeepSeek） */
export const DEFAULT_LLM_MODEL = "deepseek-flash";

/**
 * 大模型连接设置：参数优先，其次读 .env。
 * - LLM_API：接口格式，anthropic（默认）或 openai
 * - LLM_BASE_URL：端点地址，默认 DeepSeek 的 Anthropic 兼容接口
 * - LLM_MODEL：模型名，默认 deepseek-flash
 * - LLM_API_KEY（兼容旧名 DEEPSEEK_API_KEY）；.env 里的 LLM_API_KEY 优先于系统环境变量
 */
export function llmSettings(o: LlmOptions = {}) {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  const rawApi = (o.api ?? env("LLM_API") ?? "anthropic").toLowerCase();
  if (rawApi !== "anthropic" && rawApi !== "openai") throw new Error(`LLM_API 只能是 anthropic 或 openai，现在是 "${rawApi}"`);
  const api = rawApi as LlmApi;
  const rawUrl = o.baseURL ?? env("LLM_BASE_URL") ?? (api === "anthropic" ? DEEPSEEK_ANTHROPIC_BASE_URL : OPENAI_BASE_URL);
  return {
    api,
    apiKey: o.apiKey ?? env("LLM_API_KEY") ?? env("DEEPSEEK_API_KEY"),
    baseURL: normalizeBaseUrl(rawUrl, api),
    model: o.model || env("LLM_MODEL") || DEFAULT_LLM_MODEL,
  };
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * 端点地址容错：
 * - anthropic：SDK 会拼上 /v1/messages，去掉用户多写的 /v1、/v1/messages
 * - openai：请求 <端点>/chat/completions，去掉多写的 /chat/completions；只写了域名时补上 /v1
 */
export function normalizeBaseUrl(url: string, api: LlmApi = "anthropic"): string {
  let u = url.trim().replace(/\/+$/, "");
  if (api === "anthropic") return u.replace(/\/v1(\/messages)?$/, "");
  u = u.replace(/\/chat\/completions$/, "");
  try {
    if (new URL(u).pathname === "/") u += "/v1";
  } catch {}
  return u;
}

/** 日志里显示用：接口格式、端点和模型，不含密钥 */
export function describeLlm(o: LlmOptions = {}): string {
  const { api, baseURL, model } = llmSettings(o);
  let host = baseURL;
  try {
    const u = new URL(baseURL);
    host = u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {}
  return `${model} @ ${host}（${api === "openai" ? "OpenAI" : "Anthropic"} 接口）`;
}

/** 一次"强制调用某个工具"的请求：三个环节（初审、终审、文章摘要）都只用这一种形式 */
interface ToolCall {
  system: string;
  text: string;
  /** 图片地址，放在文字前面 */
  images?: string[];
  tool: { name: string; description: string; schema: Record<string, unknown> };
  maxTokens: number;
  temperature: number;
}

interface LlmClient {
  /** 返回模型提交的工具参数（未校验） */
  callTool(req: ToolCall): Promise<unknown>;
}

function createClient(o: LlmOptions): LlmClient {
  const s = llmSettings(o);
  if (!s.apiKey) throw new Error("缺少 LLM_API_KEY（或旧名 DEEPSEEK_API_KEY）。没有 API Key 时可以加 --skip-ai 用规则分试跑。");
  return s.api === "openai" ? openaiClient(s.apiKey, s.baseURL, s.model) : anthropicClient(s.apiKey, s.baseURL, s.model);
}

function anthropicClient(apiKey: string, baseURL: string, model: string): LlmClient {
  // authToken 显式置空：否则 SDK 会读环境变量 ANTHROPIC_AUTH_TOKEN 并作为 Bearer 发出，DeepSeek 等端点会优先用它而不是 LLM_API_KEY
  const client = new Anthropic({ apiKey, authToken: null, baseURL });
  return {
    async callTool(req) {
      const images: Anthropic.ImageBlockParam[] = (req.images ?? []).map((url) => ({ type: "image", source: { type: "url", url } }));
      const response = await client.messages.create({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        // DeepSeek 默认开启思考模式，而思考模式不接受强制 tool_choice；
        // 这里需要稳定的结构化结果，因此显式走非思考模式。
        thinking: { type: "disabled" },
        system: req.system,
        tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.schema as Anthropic.Tool.InputSchema }],
        tool_choice: { type: "tool", name: req.tool.name },
        messages: [{ role: "user", content: req.images === undefined ? req.text : [...images, { type: "text", text: req.text }] }],
      });
      if (response.stop_reason === "max_tokens") throw new LlmTruncatedError(req.maxTokens);
      const block = response.content.find((b) => b.type === "tool_use" && b.name === req.tool.name);
      if (!block || block.type !== "tool_use") throw new Error("模型没有按要求返回结果");
      return block.input;
    },
  };
}

/** 输出达到 token 上限被截断：工具参数不完整，需要调高上限重试 */
export class LlmTruncatedError extends Error {
  constructor(readonly maxTokens: number) {
    super(`输出超过 ${maxTokens} token 被截断`);
  }
}

export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * OpenAI Chat Completions 格式（OpenAI 以及大多数国内外兼容服务）。
 * 不同服务对参数的支持不一样，遇到明确的参数报错时自动调整一次并记住：
 * - 新模型不接受 max_tokens → 改用 max_completion_tokens
 * - 推理模型只接受默认 temperature → 不传
 * - 不支持指定工具名的 tool_choice → 改为 "required"
 */
function openaiClient(apiKey: string, baseURL: string, model: string): LlmClient {
  const quirks = { maxCompletionTokens: false, noTemperature: false, requiredChoice: false };

  async function post(body: Record<string, unknown>) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) return (await res.json()) as any;
      const text = await res.text().catch(() => "");
      // 限流和服务端错误稍等重试，最多 2 次
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      let message = text.slice(0, 500);
      try {
        message = JSON.parse(text).error?.message ?? message;
      } catch {}
      throw new LlmHttpError(res.status, `${res.status} ${message}`);
    }
  }

  function adjust(e: unknown): boolean {
    if (!(e instanceof LlmHttpError) || e.status !== 400) return false;
    const m = e.message.toLowerCase();
    if (!quirks.maxCompletionTokens && m.includes("max_tokens")) return (quirks.maxCompletionTokens = true);
    if (!quirks.noTemperature && m.includes("temperature")) return (quirks.noTemperature = true);
    if (!quirks.requiredChoice && m.includes("tool_choice")) return (quirks.requiredChoice = true);
    return false;
  }

  return {
    async callTool(req) {
      const content = req.images?.length
        ? [...req.images.map((url) => ({ type: "image_url", image_url: { url } })), { type: "text", text: req.text }]
        : req.text;
      for (;;) {
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content },
          ],
          tools: [{ type: "function", function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.schema } }],
          tool_choice: quirks.requiredChoice ? "required" : { type: "function", function: { name: req.tool.name } },
          [quirks.maxCompletionTokens ? "max_completion_tokens" : "max_tokens"]: req.maxTokens,
        };
        if (!quirks.noTemperature) body.temperature = req.temperature;
        let data: any;
        try {
          data = await post(body);
        } catch (e) {
          if (adjust(e)) continue;
          throw e;
        }
        if (data?.choices?.[0]?.finish_reason === "length") throw new LlmTruncatedError(req.maxTokens);
        const message = data?.choices?.[0]?.message;
        const call = (message?.tool_calls ?? []).find((c: any) => c?.function?.name === req.tool.name) ?? message?.tool_calls?.[0];
        const raw: string | undefined = call?.function?.arguments ?? extractJson(message?.content);
        if (!raw) throw new Error("模型没有按要求返回结果");
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error("模型返回的结果不是有效的 JSON");
        }
      }
    },
  };
}

/** 个别服务不走工具调用、直接把 JSON 写在正文里（可能包在 ```json 里），尽量取出来 */
function extractJson(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const text = (fenced ? fenced[1]! : content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

/**
 * 偶尔模型把工具参数包了一层（{"input": {...}}、{"parameters": "{...}"}）或整个给成 JSON 字符串，
 * 这时所有字段都会被判为缺失。拆开这一层再校验；看不出包装时原样返回。
 */
export function unwrapToolInput(output: unknown, expectedKey: string): unknown {
  let value = output;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        return value;
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || expectedKey in value) return value;
    const entries = Object.values(value as Record<string, unknown>);
    if (entries.length !== 1) return value;
    value = entries[0];
  }
  return value;
}

/**
 * 逐条评审：判断类型和去留、打分、写摘要、翻译、媒体说明。
 * 默认走 DeepSeek（deepseek-flash），通过 .env 的 LLM_API / LLM_BASE_URL / LLM_MODEL / LLM_API_KEY 可以换成其他兼容 Anthropic 或 OpenAI 接口的服务。
 */
export function createLlmReviewer(opts: LlmOptions = {}): Reviewer {
  const client = createClient(opts);
  const system = reviewSystemPrompt(opts.guide ?? "");
  const schema = z.toJSONSchema(ReviewOutput, { io: "input" }) as Record<string, unknown>;

  return {
    async review(tweet, topics, article) {
      // 只送文字：图片和视频都不做识别（邮件里视频只显示封面），节省 token
      const text = `候选主题：${JSON.stringify(topics)}\n\n推文：\n${JSON.stringify(tweetPayload(tweet, article), null, 2)}`;
      // 长推文要翻译全文、写阅读摘要，输出可能很长：先给 6000 token，被截断就用 8000 再试；
      // 格式不符（偶发）也再试。最多三次。
      let maxTokens = 6000;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const output = await client.callTool({
            system,
            text,
            tool: { name: REVIEW_TOOL, description: "提交对这条推文的评审结果", schema },
            maxTokens,
            temperature: 0.2,
          });
          const parsed = ReviewOutput.safeParse(unwrapToolInput(output, "verdict"));
          if (!parsed.success) throw new Error(`评审结果格式不符：${z.prettifyError(parsed.error)}`);
          return normalizeReview({ ...parsed.data, scale: 5 }, tweet, topics);
        } catch (e) {
          lastError = e;
          if (e instanceof LlmTruncatedError) maxTokens = 8000;
          else if (e instanceof LlmHttpError && e.status !== 429 && e.status < 500) throw e;
        }
      }
      throw lastError;
    },
  };
}

/** 修正模型输出里自相矛盾的地方，保证后续规则简单可靠 */
export function normalizeReview(r: AiResult, tweet: RawTweet, topics: Pick<Topic, "id">[]): AiResult {
  const result = { ...r };
  if (!topics.some((t) => t.id === result.topicId)) result.topicId = topics[0]!.id;
  // 阅读摘要只给中文版里显示超过 READER_SUMMARY_MIN_CHARS 字的推文（含 Thread），和邮件里显示摘要的条件一致
  const shown = displayTextLength(tweet, tweet.lang?.startsWith("zh") ? null : result.zh);
  const rs = result.readerSummary;
  if (rs && typeof rs === "object") result.readerSummary = { lead: rs.lead.trim(), points: rs.points.map((p) => p.trim()).filter(Boolean).slice(0, 3) };
  const lead = typeof result.readerSummary === "string" ? result.readerSummary : result.readerSummary?.lead;
  if (!lead?.trim() || shown <= READER_SUMMARY_MIN_CHARS) result.readerSummary = null;
  result.mediaNote = null;
  if (tweet.lang?.startsWith("zh")) result.zh = null;
  // 没有引用、或引用很短且完整时不需要摘要，直接显示原文
  const quotedText = tweet.quoted ? cleanTweetText(tweet.quoted.text) : "";
  if (!tweet.quoted || (xWeightedLength(quotedText) < 280 && !looksTruncated(quotedText))) result.quotedDigest = null;
  // 原文版摘要和中文版一一对应：中文版没有的这里也不要，原文是中文时两版共用中文摘要
  if (tweet.lang?.startsWith("zh") || !result.orig) result.orig = null;
  else {
    const o = result.orig;
    const rso = result.readerSummary && o.readerSummary?.lead.trim()
      ? { lead: o.readerSummary.lead.trim(), points: o.readerSummary.points.map((p) => p.trim()).filter(Boolean).slice(0, 3) }
      : null;
    const qdo = result.quotedDigest && o.quotedDigest?.summary.trim() ? o.quotedDigest : null;
    result.orig = rso || qdo ? { readerSummary: rso, quotedDigest: qdo } : null;
  }
  if (result.category === "other" && result.verdict === "keep") {
    result.verdict = "drop";
    result.dropReason ??= "other";
  }
  // 5 分制：保留的至少 3 分，剔除的不超过 2 分
  result.scale = 5;
  result.quality = Math.min(5, Math.max(1, Math.round(result.quality)));
  if (result.verdict === "drop") {
    result.dropReason ??= "other";
    result.quality = Math.min(result.quality, 2);
  } else {
    result.dropReason = null;
    result.quality = Math.max(result.quality, 3);
  }
  return result;
}

/** 编辑终审：把当天通过初审的候选放在一起，去掉同一事件、相同观点和近几天发过的内容 */
export function createLlmEditor(opts: LlmOptions = {}): Editor {
  const client = createClient(opts);
  const system = editorSystemPrompt(opts.guide ?? "");
  const schema = z.toJSONSchema(EditorialResult, { io: "input" }) as Record<string, unknown>;

  return {
    async edit(today, recent) {
      if (today.length < 2 && recent.length === 0) return { drops: [] };
      const output = await client.callTool({
        system,
        text: `今天的候选（${today.length} 条）：\n${JSON.stringify(today, null, 2)}\n\n最近几天已发送（${recent.length} 条）：\n${JSON.stringify(recent, null, 2)}`,
        tool: { name: EDIT_TOOL, description: "提交需要剔除的重复推文", schema },
        maxTokens: 4000,
        temperature: 0,
      });
      const parsed = EditorialResult.safeParse(output);
      if (!parsed.success) throw new Error(`终审结果格式不符：${z.prettifyError(parsed.error)}`);
      // 只接受今天候选里的 ID，且不能把被保留的那条也剔除
      const ids = new Set(today.map((t) => t.id));
      const drops = parsed.data.drops.filter((d) => ids.has(d.id) && d.keptId !== d.id);
      const dropped = new Set(drops.map((d) => d.id));
      return { drops: drops.filter((d) => !d.keptId || !dropped.has(d.keptId)) };
    },
  };
}

/** 不调用 AI 的替代方案：只用规则分，不翻译、不分类，用于本地试跑 */
export function createRuleOnlyReviewer(ruleScores: Map<string, number>): Reviewer {
  return {
    async review(tweet, topics) {
      const rule = ruleScores.get(tweet.id) ?? 0;
      return {
        verdict: "keep",
        category: "other",
        dropReason: null,
        quality: Math.round(3 + rule * 2),
        scale: 5,
        topicId: topics[0]!.id,
        summary: tweet.text.slice(0, 60),
        reason: "规则分（未调用 AI）",
        zh: null,
        mediaNote: null,
      };
    },
  };
}

/** 外部文章的中文图文摘要 */
export const ArticleSummary = z.object({
  /** 中文标题（原标题已是中文时照抄） */
  titleZh: z.string(),
  /** 1–2 句中文概要：文章比推文多给了什么、结论是什么 */
  summary: z.string(),
  /** 2–4 条要点：具体做法、数据、工具和限制，每条一句（正文缺失时为空） */
  points: z.array(z.string()).max(6),
});
export type ArticleSummary = z.infer<typeof ArticleSummary> & { orig?: { lang: string; summary: string; points: string[] } };

/** 要原文版概要时多填的两项 */
const ArticleSummaryWithOrig = ArticleSummary.extend({
  /** 用 origLang 写的概要，要求同 summary */
  summaryOrig: z.string(),
  /** 用 origLang 写的要点，要求同 points */
  pointsOrig: z.array(z.string()).max(6),
});

/**
 * 原文版概要用什么语言：分享它的推文是中文时不需要（两版共用中文概要）；
 * 推文语言未知（只有链接、表情等）时用文章本身的语言。
 */
export function articleOrigLang(tweetLang: string | undefined): string | null {
  if (tweetLang?.startsWith("zh")) return null;
  if (!tweetLang || ["zxx", "und", "qme", "qht", "qam"].includes(tweetLang)) return "article";
  return tweetLang;
}

export interface Summarizer {
  /** lang：分享它的推文的语言，不是中文时再写一份原文版概要 */
  summarize(article: LinkDigest, context: { tweetText: string; lang?: string }): Promise<ArticleSummary>;
}

const SUMMARY_TOOL = "submit_article_summary";

const SUMMARY_SYSTEM = `你是一份中文科技日报的编辑。推文里分享了一篇外部文章（或项目主页、产品页），读者已经能看到推文本身，
你要用很短的中文摘要告诉他们：这篇文章比推文多给了什么、值不值得点开。读者是做产品和研发、关心 AI 的人。
要求：
1. titleZh：把标题翻译成简洁的中文，30 字以内；原标题已是中文时照抄。
   去掉网站名和仓库前缀（如"GitHub - 作者/仓库："、"| 站点名"），项目页写成"项目名：一句话说明"。
2. summary：1–2 句、80 字以内，说清它是什么、核心结论或最重要的做法。
   推文（sharedWith）强调了某个具体新功能、数据或观点时，第一句就说清这一点是什么、怎么用（正文里有的话），再补一句整体背景。
   不要重复推文里已经写过的内容；不要写"本文介绍了""作者分享了"这类空话。
3. points：2–4 条要点，每条一句、40 字以内，写读者用得上的东西：具体做法或步骤、关键数据、工具和命令名、限制条件。
   一律不写：版本号和更新记录、配件和周边价格、导航、版权、下载按钮、捐赠提示，也不要描述页面本身（"页面只有……""没有教程"）。
   读者不是这个领域的工程师：部署参数、配置项这类细节最多写一条，并说明它意味着什么（比如省了多少卡、快了多少）；
   每条要点最多一个专门术语，原文的缩写能不写就不写。
4. 只根据给你的标题、简介和正文写，不要编造正文里没有的信息（包括"无需注册""免费"这类判断），数字必须和正文一致。
   正文很短或缺失（只有标题和简介）时，summary 只写一句，points 为空数组。
5. 保留专有名词、产品名、代码和数字。
6. 给了 origLang 时（原文版邮件用），再用这种语言写 summaryOrig 和 pointsOrig：与 summary、points 内容对应，
   第 2–5 条的要求全部相同，篇幅按语言换算（英文时 summary 约 50 个单词以内，每条要点约 25 个单词以内）。
   origLang 为 article 时用文章正文本身的语言。`;

/** 为进入邮件的外部文章生成中文标题、概要和要点 */
export function createLlmSummarizer(opts: LlmOptions = {}): Summarizer {
  const client = createClient(opts);
  const schema = z.toJSONSchema(ArticleSummary, { io: "input" }) as Record<string, unknown>;
  const schemaWithOrig = z.toJSONSchema(ArticleSummaryWithOrig, { io: "input" }) as Record<string, unknown>;
  return {
    async summarize(article, context) {
      const origLang = articleOrigLang(context.lang);
      const payload = {
        url: article.finalUrl ?? article.url,
        site: article.siteName,
        title: article.title,
        description: article.description,
        text: article.excerpt?.slice(0, 10_000),
        sharedWith: context.tweetText.slice(0, 500),
        ...(origLang ? { origLang } : {}),
      };
      const output = await client.callTool({
        system: SUMMARY_SYSTEM,
        text: `文章：\n${JSON.stringify(payload, null, 2)}`,
        tool: { name: SUMMARY_TOOL, description: "提交文章的中文摘要", schema: origLang ? schemaWithOrig : schema },
        maxTokens: origLang ? 2500 : 1500,
        temperature: 0.2,
      });
      const cleanPoints = (points: string[]) => points.filter((p) => p.trim()).slice(0, 4);
      if (origLang) {
        const parsed = ArticleSummaryWithOrig.safeParse(output);
        if (!parsed.success) throw new Error(`摘要格式不符：${z.prettifyError(parsed.error)}`);
        const { summaryOrig, pointsOrig, ...zh } = parsed.data;
        return { ...zh, points: cleanPoints(zh.points), orig: { lang: origLang, summary: summaryOrig, points: cleanPoints(pointsOrig) } };
      }
      const parsed = ArticleSummary.safeParse(output);
      if (!parsed.success) throw new Error(`摘要格式不符：${z.prettifyError(parsed.error)}`);
      return { ...parsed.data, points: cleanPoints(parsed.data.points) };
    },
  };
}
