import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { collectRange, type TimeRange } from "./time.ts";
import { ContentCategory } from "./types.ts";

const TopicSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "主题 id 用小写字母、数字、连字符"),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  /** 订阅页主题卡片上的一句话说明 */
  description: z.string().optional(),
  /** 并入本主题的旧主题 id：老订阅者的选择、旧推文和旧 RSS 地址都会映射到本主题 */
  aliases: z.array(z.string()).default([]),
  accounts: z
    .array(z.string().regex(/^[A-Za-z0-9_]{1,15}$/, "X 账号最长 15 个字符，只含字母、数字、下划线，不带 @"))
    .min(1)
    .transform((list) => list.map((h) => h.toLowerCase())),
});
export type Topic = z.infer<typeof TopicSchema>;

const TopicsFile = z.object({
  topics: z
    .array(TopicSchema)
    .min(1)
    .refine((ts) => new Set(ts.map((t) => t.id)).size === ts.length, "主题 id 不能重复")
    .refine((ts) => {
      const all = ts.flatMap((t) => [t.id, ...t.aliases]);
      return new Set(all).size === all.length;
    }, "aliases 不能与主题 id 或其他主题的 aliases 重复"),
});

const DigestFile = z.object({
  send_time: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
  timezone: z.string().default("Asia/Shanghai"),
  /** previous_day：只取前一天（按 timezone 的 0:00–24:00）发布的推文；rolling：最近 window_hours 小时 */
  collect_window: z.enum(["previous_day", "rolling"]).default("previous_day"),
  window_hours: z.number().positive().default(24),
  digest: z.object({
    total_items: z.number().int().min(1).max(30).default(10),
    min_per_topic: z.number().int().min(0).default(1),
    candidates_per_topic: z.number().int().min(1).default(15),
  }),
  filters: z.object({
    include_replies: z.boolean().default(false),
    include_reposts: z.boolean().default(false),
    min_text_length: z.number().int().min(0).default(20),
    min_quality: z.number().min(0).max(10).default(5),
  }),
  media_weight: z.object({
    text: z.number().min(0).default(1),
    image: z.number().min(0).default(1),
    video: z.number().min(0).default(0.6),
  }),
  video_mode: z.enum(["summary", "thumbnail"]).default("summary"),
  thread: z.object({
    merge: z.boolean().default(true),
    max_parts: z.number().int().min(1).default(8),
  }),
  languages: z.array(z.enum(["zh", "orig"])).min(1).default(["zh", "orig"]),
  default_language: z.enum(["zh", "orig"]).default("zh"),
  rss: z.object({
    items_per_feed: z.number().int().min(1).default(30),
  }),
  subscribe_page: z
    .object({
      /** 每个主题卡片最多显示几个博主头像，超出部分显示为 +N */
      max_avatars: z.number().int().min(1).max(30).default(7),
      /** 已订阅的邮箱再次提交订阅表单时，直接用新选择覆盖主题和语言（会给该邮箱发一封变更通知） */
      overwrite_existing: z.boolean().default(true),
    })
    .prefault({}),
  links: z
    .object({
      /** 抓取推文（含引用推文）里的外部文章，取标题、封面和正文 */
      fetch: z.boolean().default(true),
      /** 对通过精选的推文里的文章，用大模型生成中文标题、概要和要点 */
      summarize: z.boolean().default(true),
      timeout_ms: z.number().int().min(1000).default(12000),
      max_bytes: z.number().int().min(10_000).default(3_000_000),
      /** 这些域名不抓取（需要登录或没有正文） */
      skip_domains: z.array(z.string()).default(["x.com", "twitter.com", "t.co"]),
    })
    .prefault({}),
  mail: z
    .object({
      /** 主题组合和语言完全相同的订阅者内容一样，合并成一封邮件用密送发出，减少 SMTP 发信次数 */
      group_identical: z.boolean().default(true),
      /** 每封合并邮件最多密送多少人，超过时分成多封 */
      bcc_batch_size: z.number().int().min(1).max(100).default(20),
      /** 两封邮件之间的间隔（毫秒） */
      send_interval_ms: z.number().int().min(0).default(1500),
    })
    .prefault({}),
  curation: z
    .object({
      /** 只有这些类型的内容能进入邮件 */
      allowed_categories: z.array(ContentCategory).min(1).default(["best_practice", "real_problem", "industry_trend", "expert_insight"]),
      /** 单条评审后，再让模型把当天全部候选放在一起做一次终审（去重、去同一事件） */
      editor_pass: z.boolean().default(true),
      /** 终审时对照最近几天已经发过的内容，避免隔天重复 */
      recent_days: z.number().int().min(0).default(3),
    })
    .default({ allowed_categories: ["best_practice", "real_problem", "industry_trend", "expert_insight"], editor_pass: true, recent_days: 3 }),
});
export type DigestConfig = z.infer<typeof DigestFile>;

const Range = z.tuple([z.number().min(0), z.number().min(0)]).refine(([a, b]) => a <= b, "范围的第一个数不能大于第二个数");

const CrawlFile = z.object({
  active_hours: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]).default([6, 23]),
  start_jitter_min: Range.default([0, 20]),
  budget: z
    .object({
      max_accounts_per_run: z.number().int().min(1).default(40),
      max_page_loads_per_run: z.number().int().min(1).default(80),
      max_detail_per_run: z.number().int().min(0).default(25),
      max_scrolls_per_account: z.number().int().min(1).default(6),
    })
    .prefault({}),
  pacing: z
    .object({
      account_delay_sec: Range.default([8, 25]),
      detail_delay_sec: Range.default([6, 18]),
      scroll_pause_ms: Range.default([1200, 3500]),
      long_break_every: Range.default([6, 10]),
      long_break_sec: Range.default([60, 180]),
    })
    .prefault({}),
  min_interval_hours: z.number().min(0).default(20),
  cooldown: z
    .object({
      rate_limited_hours: z.number().min(0).default(24),
      captcha_hours: z.number().min(0).default(48),
      error_hours: z.number().min(0).default(6),
      login_required: z.union([z.literal("manual"), z.number().min(0)]).default("manual"),
      backoff_multiplier: z.number().min(1).default(2),
      max_hours: z.number().min(1).default(168),
    })
    .prefault({}),
});
export type CrawlConfig = z.infer<typeof CrawlFile>;

export interface AppConfig {
  topics: Topic[];
  digest: DigestConfig;
  /** 账号 → 所属主题 id（按 topics.yaml 中的顺序） */
  accountTopics: Map<string, string[]>;
  /** 旧主题 id → 现在的主题 id（来自 topics.yaml 的 aliases） */
  topicAliases: Map<string, string>;
  /** 所有需要采集的账号（去重） */
  accounts: string[];
  /** config/crawl.yaml：采集节流策略（文件不存在时用默认值） */
  crawl: CrawlConfig;
  /** config/curation.md：精选标准，原样放进给大模型的提示词，可以直接编辑 */
  curationGuide: string;
  configDir: string;
}

/** 把主题 id 换成现在的 id：旧 id 按 aliases 映射，已删除的丢掉，去重并保持 topics.yaml 中的顺序 */
export function normalizeTopicIds(config: Pick<AppConfig, "topics" | "topicAliases">, ids: readonly string[]): string[] {
  const wanted = new Set(ids.map((id) => config.topicAliases.get(id) ?? id));
  return config.topics.map((t) => t.id).filter((id) => wanted.has(id));
}

/** 单个主题 id 换成现在的 id；找不到时返回 undefined */
export function resolveTopicId(config: Pick<AppConfig, "topics" | "topicAliases">, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const cur = config.topicAliases.get(id) ?? id;
  return config.topics.some((t) => t.id === cur) ? cur : undefined;
}

/** 从当前目录向上查找包含 config/topics.yaml 的仓库根目录 */
export function findRepoRoot(start = process.cwd()): string {
  // 运行时按需查找，不让打包工具追踪整个项目目录
  let dir = resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (existsSync(join(dir, "config", "topics.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`找不到 config/topics.yaml（从 ${start} 向上查找）。可以设置 CONFIG_DIR 环境变量。`);
    }
    dir = parent;
  }
}

export function resolveConfigDir(): string {
  return process.env.CONFIG_DIR ? resolve(process.env.CONFIG_DIR) : join(findRepoRoot(), "config");
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}

function formatIssues(file: string, error: z.ZodError): string {
  return `${file} 配置有误：\n${z.prettifyError(error)}`;
}

export function loadConfig(configDir = resolveConfigDir()): AppConfig {
  const topicsPath = join(configDir, "topics.yaml");
  const digestPath = join(configDir, "digest.yaml");

  const topicsParsed = TopicsFile.safeParse(readYaml(topicsPath));
  if (!topicsParsed.success) throw new Error(formatIssues(topicsPath, topicsParsed.error));
  const digestParsed = DigestFile.safeParse(readYaml(digestPath));
  if (!digestParsed.success) throw new Error(formatIssues(digestPath, digestParsed.error));

  const crawlPath = join(configDir, "crawl.yaml");
  const crawlParsed = CrawlFile.safeParse(existsSync(crawlPath) ? (readYaml(crawlPath) ?? {}) : {});
  if (!crawlParsed.success) throw new Error(formatIssues(crawlPath, crawlParsed.error));

  const { topics } = topicsParsed.data;
  const accountTopics = new Map<string, string[]>();
  for (const topic of topics) {
    for (const handle of topic.accounts) {
      const list = accountTopics.get(handle) ?? [];
      if (!list.includes(topic.id)) list.push(topic.id);
      accountTopics.set(handle, list);
    }
  }

  const topicAliases = new Map(topics.flatMap((t) => t.aliases.map((a) => [a, t.id] as const)));

  return {
    topics,
    digest: digestParsed.data,
    accountTopics,
    topicAliases,
    accounts: [...accountTopics.keys()],
    crawl: crawlParsed.data,
    curationGuide: existsSync(join(configDir, "curation.md")) ? readFileSync(join(configDir, "curation.md"), "utf8").trim() : "",
    configDir,
  };
}

let cached: AppConfig | undefined;
/** 进程内缓存一份配置（网站用） */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** 本次运行要处理的推文发布时间范围（见 digest.yaml 的 collect_window） */
export function runRange(config: AppConfig, runDate: string, now = new Date()): TimeRange {
  const d = config.digest;
  return collectRange({ mode: d.collect_window, timezone: d.timezone, windowHours: d.window_hours }, runDate, now);
}
