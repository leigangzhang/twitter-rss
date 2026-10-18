import Anthropic from "@anthropic-ai/sdk";
import { AiResult, type ContentCategory, type RawTweet, type Topic } from "@xrss/core";
import { z } from "zod";

/** DeepSeek 的 Anthropic 兼容接口：https://api-docs.deepseek.com/guides/anthropic_api */
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

/** config/curation.md 缺失时使用的精选标准（与仓库里的默认文件一致的精简版） */
const DEFAULT_GUIDE = `## 要保留的四类内容
- best_practice 最佳实践与应用：具体可操作、读者能照着做的做法，要有细节。
- real_problem 真实世界问题：一线的实际问题、事故复盘、带数据的观察。
- industry_trend 行业趋势与解读：重要事件 + 为什么重要、影响谁、接下来会怎样；只转述新闻不算。
- expert_insight 行业领袖与专家思考：有论证的原创判断、反直觉洞察、经验提炼的原则。
## 要剔除
preachy 说教、obvious 显而易见、shallow 没有思考、repost 纯搬运、duplicate 重复、promo 推广、chitchat 闲聊。
拿不准时剔除；具体胜过抽象；增量胜过转述；不因作者名气放宽标准。`;

/** 第一步：逐条评审 */
export function reviewSystemPrompt(guide: string): string {
  return `你是一份 X（Twitter）每日精选邮件的资深编辑，只为读者挑出真正有价值的内容。读者是中文用户，希望不打开 X 就能读懂每条推文。

下面是这份邮件的精选标准，必须严格执行：

<curation_guide>
${guide || DEFAULT_GUIDE}
</curation_guide>

对给你的这条推文，按顺序完成：
1. 先判断它是什么类型（category）：best_practice / real_problem / industry_trend / expert_insight，都不是则为 other。
   看实质内容而不是话题：讲 AI 的空话仍然是 other。
2. 再判断去留（verdict）：符合上面四类之一且有实质内容才 keep；否则 drop，并在 dropReason 里选最主要的原因
   （preachy / obvious / shallow / repost / duplicate / promo / chitchat / other）。keep 时 dropReason 为 null。
   category 为 other 时 verdict 必须是 drop。
3. 打质量分 quality（0–10），按标准里的打分参考；drop 的内容不超过 4 分。
4. 从给定的候选主题里选一个最贴近的 topicId。
5. summary：用一句 30–60 字的中文概括这条推文讲了什么（事实 + 观点），后面会用它判断不同推文是否重复。
6. reason：用一句中文说明你的判断理由，指出它属于哪类、具体价值在哪里，或者为什么剔除。
7. 如果原文不是中文，把正文、Thread 后续部分、引用推文、链接标题和简介翻译成自然流畅的简体中文，填进 zh；
   保留专有名词、代码、数字和 @账号，不添加原文没有的内容。原文已是中文时 zh 为 null。drop 的内容也要照常翻译。
8. 如果有视频，或图片里有对理解推文很重要的文字/图表，用一两句中文写 mediaNote，说明它展示了什么；
   只根据你能看到的封面、图片和推文内容来写，不确定时说"根据封面和推文推测"。没有则为 null。

线程（thread）是作者本人的连续推文，与正文一起作为一个整体评审。引用推文（quoted）是作者在评论的对象：
作者只是转发并附一句"值得一读"时，价值主要来自被引用的内容，要看作者有没有增量。`;
}

/** 第二步：编辑终审（同一天的候选放在一起看） */
export function editorSystemPrompt(guide: string): string {
  return `你是一份 X（Twitter）每日精选邮件的主编。下面是今天已经通过初审的候选推文，每条都有类型、分数和一句话摘要。
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

function tweetPayload(t: RawTweet) {
  return {
    author: `${t.author.name} (@${t.author.handle})`,
    lang: t.lang,
    text: t.text,
    textTruncated: t.textTruncated || undefined,
    thread: t.thread.map((p) => p.text),
    quoted: t.quoted ? { author: `@${t.quoted.author.handle}`, text: t.quoted.text } : undefined,
    links: t.links.map((l) => ({ kind: l.kind, url: l.expandedUrl, title: l.title, description: l.description })),
    media: t.media.map((m) => ({ type: m.type, durationSec: m.durationSec, altText: m.altText })),
    metrics: t.metrics,
  };
}

export interface Reviewer {
  review(tweet: RawTweet, topics: Pick<Topic, "id" | "name">[]): Promise<AiResult>;
}

export interface Editor {
  edit(today: EditorialItem[], recent: Array<{ id: string; summary: string }>): Promise<EditorialResult>;
}

export interface LlmOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** config/curation.md 的内容 */
  guide?: string;
}

function createClient({ apiKey = process.env.DEEPSEEK_API_KEY, baseURL = process.env.LLM_BASE_URL || DEEPSEEK_ANTHROPIC_BASE_URL }: LlmOptions) {
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY。没有 API Key 时可以加 --skip-ai 用规则分试跑。");
  return new Anthropic({ apiKey, baseURL });
}

const modelOf = (o: LlmOptions) => o.model || process.env.LLM_MODEL || "deepseek-flash";

function toolInput(response: Anthropic.Message, name: string): unknown {
  const block = response.content.find((b) => b.type === "tool_use" && b.name === name);
  if (!block || block.type !== "tool_use") throw new Error("模型没有按要求返回结果");
  return block.input;
}

/**
 * 逐条评审：判断类型和去留、打分、写摘要、翻译、媒体说明。
 * 默认走 DeepSeek（deepseek-flash），通过 LLM_BASE_URL / LLM_MODEL 可以换成其他兼容 Anthropic 接口的服务。
 */
export function createLlmReviewer(opts: LlmOptions = {}): Reviewer {
  const client = createClient(opts);
  const model = modelOf(opts);
  const system = reviewSystemPrompt(opts.guide ?? "");
  const inputSchema = z.toJSONSchema(AiResult, { io: "input" }) as Anthropic.Tool.InputSchema;

  async function call(tweet: RawTweet, topics: Pick<Topic, "id" | "name">[], withImages: boolean) {
    // 图片和视频封面一并给模型看（最多 3 张），用于生成 mediaNote
    const images: Anthropic.ImageBlockParam[] = withImages
      ? tweet.media.slice(0, 3).map((m) => ({ type: "image", source: { type: "url", url: m.url } }))
      : [];
    return client.messages.create({
      model,
      max_tokens: 3000,
      temperature: 0.2,
      system,
      tools: [{ name: REVIEW_TOOL, description: "提交对这条推文的评审结果", input_schema: inputSchema }],
      tool_choice: { type: "tool", name: REVIEW_TOOL },
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `候选主题：${JSON.stringify(topics)}\n\n推文：\n${JSON.stringify(tweetPayload(tweet), null, 2)}`,
            },
          ],
        },
      ],
    });
  }

  return {
    async review(tweet, topics) {
      let response: Anthropic.Message;
      try {
        response = await call(tweet, topics, true);
      } catch (e) {
        // 图片读取失败或模型不接受图片时，退回纯文字评审，不让一张图拖垮整条推文
        if (tweet.media.length === 0) throw e;
        response = await call(tweet, topics, false);
      }
      const parsed = AiResult.safeParse(toolInput(response, REVIEW_TOOL));
      if (!parsed.success) throw new Error(`评审结果格式不符：${z.prettifyError(parsed.error)}`);
      return normalizeReview(parsed.data, tweet, topics);
    },
  };
}

/** 修正模型输出里自相矛盾的地方，保证后续规则简单可靠 */
export function normalizeReview(r: AiResult, tweet: RawTweet, topics: Pick<Topic, "id">[]): AiResult {
  const result = { ...r };
  if (!topics.some((t) => t.id === result.topicId)) result.topicId = topics[0]!.id;
  if (tweet.lang?.startsWith("zh")) result.zh = null;
  if (result.category === "other" && result.verdict === "keep") {
    result.verdict = "drop";
    result.dropReason ??= "other";
  }
  if (result.verdict === "drop") {
    result.dropReason ??= "other";
    result.quality = Math.min(result.quality, 4);
  } else {
    result.dropReason = null;
  }
  return result;
}

/** 编辑终审：把当天通过初审的候选放在一起，去掉同一事件、相同观点和近几天发过的内容 */
export function createLlmEditor(opts: LlmOptions = {}): Editor {
  const client = createClient(opts);
  const model = modelOf(opts);
  const system = editorSystemPrompt(opts.guide ?? "");
  const inputSchema = z.toJSONSchema(EditorialResult, { io: "input" }) as Anthropic.Tool.InputSchema;

  return {
    async edit(today, recent) {
      if (today.length < 2 && recent.length === 0) return { drops: [] };
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        temperature: 0,
        system,
        tools: [{ name: EDIT_TOOL, description: "提交需要剔除的重复推文", input_schema: inputSchema }],
        tool_choice: { type: "tool", name: EDIT_TOOL },
        messages: [
          {
            role: "user",
            content: `今天的候选（${today.length} 条）：\n${JSON.stringify(today, null, 2)}\n\n最近几天已发送（${recent.length} 条）：\n${JSON.stringify(recent, null, 2)}`,
          },
        ],
      });
      const parsed = EditorialResult.safeParse(toolInput(response, EDIT_TOOL));
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
        quality: Math.round((5 + rule * 5) * 10) / 10,
        topicId: topics[0]!.id,
        summary: tweet.text.slice(0, 60),
        reason: "规则分（未调用 AI）",
        zh: null,
        mediaNote: null,
      };
    },
  };
}
