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
    .refine((ts) => new Set(ts.map((t) => t.id)).size === ts.length, "主题 id 不能重复"),
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
  /** 所有需要采集的账号（去重） */
  accounts: string[];
  /** config/crawl.yaml：采集节流策略（文件不存在时用默认值） */
  crawl: CrawlConfig;
  /** config/curation.md：精选标准，原样放进给大模型的提示词，可以直接编辑 */
  curationGuide: string;
  configDir: string;
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

  return {
    topics,
    digest: digestParsed.data,
    accountTopics,
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
