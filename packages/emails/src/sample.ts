import { type AiResult, type DigestView, type Lang, RawTweet, dateLabel, localDate, mediaKind, toCardView } from "@xrss/core";

/** 预览用的示例数据（虚构博主），与设计稿内容一致 */
const now = new Date("2026-10-18T07:00:00+08:00");
const tz = "Asia/Shanghai";

const samples: Array<{ topicId: string; raw: unknown; ai: AiResult }> = [
  {
    topicId: "ai",
    raw: {
      id: "1900000000000000101",
      url: "https://x.com/mirachen_ml/status/1900000000000000101",
      author: { handle: "mirachen_ml", name: "Mira Chen" },
      createdAt: "2026-10-18T01:12:00Z",
      lang: "en",
      text: "Spent the week benchmarking small models on long-context retrieval. The surprising part: past ~32k tokens, retrieval quality depends far more on where the fact sits in the prompt than on model size. Put your key instructions at the end, not the start. We ran 4 model sizes across 8k, 32k, 64k and 128k contexts with the same needle set, and the gap between sizes nearly vanished beyond 32k.",
      metrics: { likes: 23000, reposts: 3104, replies: 210, quotes: 88 },
    },
    ai: {
      quality: 9,
      topicId: "ai",
      reason: "一手实验结论，信息密度高",
      zh: {
        text: "这周在测试小模型的长上下文检索能力。意外的发现是：超过约 3.2 万 token 后，检索效果更取决于信息在提示中的位置，而不是模型大小。关键指令请放在末尾，而不是开头。我们用同一组测试样本，在 8k、32k、64k、128k 四种长度下测了 4 个尺寸的模型，超过 32k 后不同尺寸的差距几乎消失。",
        thread: [],
      },
      mediaNote: null,
    },
  },
  {
    topicId: "ai",
    raw: {
      id: "1900000000000000102",
      url: "https://x.com/theopark/status/1900000000000000102",
      author: { handle: "theopark", name: "Theo Park" },
      createdAt: "2026-10-17T23:40:00Z",
      lang: "en",
      text: "We shipped our eval harness as open source today. Two things we learned building it:",
      thread: [
        { id: "1900000000000000103", text: "Graders drift. Pin the grader model version or your scores move week to week for no real reason." },
        { id: "1900000000000000104", text: "Small, hand-checked sets beat large noisy ones. 200 clean examples told us more than 5,000 scraped ones." },
      ],
      metrics: { likes: 8912, reposts: 1227, replies: 140, quotes: 31 },
    },
    ai: {
      quality: 8,
      topicId: "ai",
      reason: "开源项目的实践经验",
      zh: {
        text: "我们今天开源了评测框架。做的过程中学到两件事：",
        thread: ["评分模型会漂移。一定要固定评分模型的版本，否则分数会每周无故波动。", "少量人工核验的数据胜过大量噪声数据。200 条干净样本告诉我们的，比 5000 条抓取样本还多。"],
      },
      mediaNote: null,
    },
  },
  {
    topicId: "crypto",
    raw: {
      id: "1900000000000000105",
      url: "https://x.com/kainovak_eth/status/1900000000000000105",
      author: { handle: "kainovak_eth", name: "Kai Novak" },
      createdAt: "2026-10-18T03:30:00Z",
      lang: "en",
      text: "This is the clearest write-up of the fee changes I have seen. Worth the 10 minutes.",
      metrics: { likes: 3215, reposts: 488, replies: 52, quotes: 12 },
      quoted: {
        id: "1900000000000000090",
        url: "https://x.com/lenaortiz/status/1900000000000000090",
        author: { handle: "lenaortiz", name: "Lena Ortiz" },
        text: "New post: what the upcoming fee market update means for rollups, wallets and everyday users, with worked examples.",
      },
      links: [
        {
          url: "https://t.co/abc",
          expandedUrl: "https://example-research.xyz/fee-market",
          domain: "example-research.xyz",
          title: "The fee market update, explained with examples",
          description: "A section-by-section look at how the new fee mechanism affects rollups, wallets and users.",
        },
      ],
    },
    ai: {
      quality: 7,
      topicId: "crypto",
      reason: "推荐了高质量长文",
      zh: {
        text: "这是我看过把费用调整讲得最清楚的一篇，值得花 10 分钟读完。",
        thread: [],
        quotedText: "新文章：即将到来的费用市场调整，对 Rollup、钱包和普通用户分别意味着什么，附实例演算。",
        linkTitle: "费用市场调整详解（附实例）",
        linkDescription: "逐项拆解新费用机制对 Rollup、钱包和普通用户的影响。",
      },
      mediaNote: null,
    },
  },
  {
    topicId: "crypto",
    raw: {
      id: "1900000000000000106",
      url: "https://x.com/danawolfe/status/1900000000000000106",
      author: { handle: "danawolfe", name: "Dana Wolfe" },
      createdAt: "2026-10-18T06:22:00Z",
      lang: "en",
      text: "Walked through how we audit a smart contract before mainnet, start to finish.",
      media: [{ type: "video", url: "https://placehold.co/1280x720/2B2F36/2B2F36.png", width: 1280, height: 720, durationSec: 408 }],
      metrics: { likes: 1960, reposts: 301, replies: 40, quotes: 5 },
    },
    ai: {
      quality: 7,
      topicId: "crypto",
      reason: "完整流程演示",
      zh: { text: "从头到尾演示了我们在主网上线前如何审计一份智能合约。", thread: [] },
      mediaNote: "作者演示合约上线前的完整审计流程：静态扫描、权限检查、模糊测试，以及如何整理审计报告。",
    },
  },
  {
    topicId: "startup",
    raw: {
      id: "1900000000000000107",
      url: "https://x.com/lenaortiz/status/1900000000000000107",
      author: { handle: "lenaortiz", name: "Lena Ortiz" },
      createdAt: "2026-10-18T00:03:00Z",
      lang: "en",
      text: "The best early-stage founders I have backed all did one thing: they wrote down what would make them wrong, before they started. Then they checked it every month.",
      metrics: { likes: 11000, reposts: 1840, replies: 230, quotes: 60 },
    },
    ai: {
      quality: 8,
      topicId: "startup",
      reason: "可操作的创业方法",
      zh: { text: "我投过的最优秀的早期创始人都做过同一件事：开始之前先写下\"什么情况说明我错了\"，然后每个月对照检查。", thread: [] },
      mediaNote: null,
    },
  },
];

const topics = [
  { id: "ai", name: "AI 与大模型", color: "#1F5FD6" },
  { id: "crypto", name: "加密货币", color: "#B85A0A" },
  { id: "startup", name: "创业与投资", color: "#2F7D4F" },
];

export function sampleDigest(lang: Lang): DigestView {
  const cards = samples.map((s) => {
    const raw = RawTweet.parse(s.raw);
    return toCardView({ id: raw.id, topicId: s.topicId, kind: mediaKind(raw), raw, ai: s.ai }, { lang, timezone: tz, videoMode: "summary", maxThreadParts: 8, now });
  });
  const groups = topics.map((topic) => ({ topic, items: cards.filter((c) => c.topicId === topic.id) }));
  return {
    date: localDate(now, tz),
    dateLabel: dateLabel(now, tz),
    lang,
    total: cards.length,
    topicCount: groups.length,
    accountCount: 40,
    scannedCount: 186,
    groups,
    links: { manage: "#", switchLang: "#", unsubscribe: "#", rss: "#" },
  };
}
