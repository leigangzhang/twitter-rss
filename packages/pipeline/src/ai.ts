import Anthropic from "@anthropic-ai/sdk";
import { AiResult, type RawTweet, type Topic } from "@xrss/core";
import { z } from "zod";

const SYSTEM = `你是一份 X（Twitter）每日精选邮件的编辑。读者是中文用户，希望不打开 X 就能读懂每条推文。
对给你的每条推文，你要：
1. 打质量分 quality（0–10）：看信息密度、原创性、对读者的价值。一手经验、数据、独到观点给高分；
   寒暄、纯情绪、无上下文的玩笑、广告推广、只有一个链接没有观点的给低分。
2. 从给定的候选主题里选一个最贴近的 topicId。
3. 如果原文不是中文，把正文、Thread 后续部分、引用推文、链接标题和简介翻译成自然流畅的简体中文，
   填进 zh。保留专有名词、代码、数字和 @账号；不要添加原文没有的内容。原文已是中文时 zh 为 null。
4. 如果有视频，或图片里有对理解推文很重要的文字/图表，用一两句中文写 mediaNote，说明它展示了什么。
   只根据你能看到的封面、图片和推文内容来写，不确定时说"根据封面和推文推测"。没有则为 null。
5. reason 用一句中文说明打分理由。`;

const TOOL_NAME = "submit_review";

function tweetPayload(t: RawTweet) {
  return {
    author: `${t.author.name} (@${t.author.handle})`,
    lang: t.lang,
    text: t.text,
    thread: t.thread.map((p) => p.text),
    quoted: t.quoted ? { author: `@${t.quoted.author.handle}`, text: t.quoted.text } : undefined,
    links: t.links.map((l) => ({ url: l.expandedUrl, title: l.title, description: l.description })),
    media: t.media.map((m) => ({ type: m.type, durationSec: m.durationSec, altText: m.altText })),
    metrics: t.metrics,
  };
}

export interface Reviewer {
  review(tweet: RawTweet, topics: Pick<Topic, "id" | "name">[]): Promise<AiResult>;
}

export function createClaudeReviewer(apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.AI_MODEL || "claude-haiku-5-5"): Reviewer {
  if (!apiKey) throw new Error("缺少 ANTHROPIC_API_KEY。没有 API Key 时可以加 --skip-ai 用规则分试跑。");
  const client = new Anthropic({ apiKey });
  const inputSchema = z.toJSONSchema(AiResult, { io: "input" }) as Anthropic.Tool.InputSchema;

  return {
    async review(tweet, topics) {
      // 图片和视频封面一并给模型看（最多 3 张），用于生成 mediaNote
      const images: Anthropic.ImageBlockParam[] = tweet.media.slice(0, 3).map((m) => ({ type: "image", source: { type: "url", url: m.url } }));
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        tools: [{ name: TOOL_NAME, description: "提交对这条推文的评审结果", input_schema: inputSchema }],
        tool_choice: { type: "tool", name: TOOL_NAME },
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
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") throw new Error("模型没有返回评审结果");
      const parsed = AiResult.safeParse(block.input);
      if (!parsed.success) throw new Error(`评审结果格式不符：${z.prettifyError(parsed.error)}`);
      const result = parsed.data;
      if (!topics.some((t) => t.id === result.topicId)) result.topicId = topics[0]!.id;
      if (tweet.lang?.startsWith("zh")) result.zh = null;
      return result;
    },
  };
}

/** 不调用 AI 的替代方案：只用规则分，不翻译，用于本地试跑 */
export function createRuleOnlyReviewer(ruleScores: Map<string, number>): Reviewer {
  return {
    async review(tweet, topics) {
      const rule = ruleScores.get(tweet.id) ?? 0;
      return { quality: Math.round((5 + rule * 5) * 10) / 10, topicId: topics[0]!.id, reason: "规则分（未调用 AI）", zh: null, mediaNote: null };
    },
  };
}
