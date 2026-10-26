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

const KEEP_CATEGORIES = ["best_practice", "real_problem", "new_release", "showcase", "industry_trend", "expert_insight"] as const;

const DigestFile = z.object({
  send_time: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
  timezone: z.string().default("Asia/Shanghai"),
  /** previous_day：只取前一天（按 timezone 的 0:00–24:00）发布的推文；rolling：最近 window_hours 小时 */
  collect_window: z.enum(["previous_day", "rolling"]).default("previous_day"),
  window_hours: z.number().positive().default(24),
  digest: z.object({
    total_items: z.number().int().min(1).max(60).default(30),
    min_per_topic: z.number().int().min(0).default(1),
    candidates_per_topic: z.number().int().min(1).default(15),
  }),
  filters: z.object({
    include_replies: z.boolean().default(false),
    include_reposts: z.boolean().default(false),
    min_text_length: z.number().int().min(0).default(20),
    min_quality: z.number().min(1).max(5).default(3),
  }),
  media_weight: z.object({
    text: z.number().min(0).default(1),
    image: z.number().min(0).default(1),
    video: z.number().min(0).default(0.6),
  }),
  video_mode: z.enum(["summary", "thumbnail"]).default("thumbnail"),
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
      /** 主题标签页：支持的邮箱（苹果邮件、163 网页版等）可切换主题，其他邮箱自动按主题依次排列 */
      tabs: z.boolean().default(true),
      /** 每封邮件的大小上限（KB）。Gmail 超过约 102KB 会折叠末尾，超出时分卷发送 */
      max_kb: z.number().min(20).max(500).default(95),
      /** 内容超过 max_kb 时最多分几封发送；最后一封仍放不下的部分改为一句话摘要。1 = 不分卷 */
      max_parts: z.number().int().min(1).max(5).default(3),
    })
    .prefault({}),
  curation: z
    .object({
      /** 只有这些类型的内容能进入邮件 */
      allowed_categories: z.array(ContentCategory).min(1).default([...KEEP_CATEGORIES]),
      /** 单条评审后，再让模型把当天全部候选放在一起做一次终审（去重、去同一事件） */
      editor_pass: z.boolean().default(true),
      /** 终审时对照最近几天已经发过的内容，避免隔天重复 */
      recent_days: z.number().int().min(0).default(3),
    })
    .default({ allowed_categories: [...KEEP_CATEGORIES], editor_pass: true, recent_days: 3 }),
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
  /** 轮转到的账号最多补收多少天前的内容（从上次入库覆盖到的时间点开始） */
  catch_up_days: z.number().int().min(1).max(14).default(4),
  /** 按账号近期内容质量分档，决定采集频率 */
  account_quality: z
    .object({
      /** 统计最近多少天评审过的推文（建议 7–14 天：既能反映账号近况，样本也够） */
      stats_days: z.number().int().min(1).max(60).default(14),
      /** 评审过的推文少于这个数时，样本不足，按"普通"处理 */
      min_samples: z.number().int().min(1).default(6),
      /** 保留率（AI 判为保留的比例）达到这个值为"优质" */
      good_keep_rate: z.number().min(0).max(1).default(0.35),
      /** 保留率低于这个值为"低质" */
      poor_keep_rate: z.number().min(0).max(1).default(0.12),
      /** 超过这么多天没发推的账号视为"不活跃"，按低质的频率采集 */
      inactive_days: z.number().int().min(1).default(14),
      /** 各档采集间隔（小时）：优质每次都采，普通约隔天，低质约 3 天一次 */
      interval_hours: z
        .object({
          good: z.number().min(0).default(20),
          normal: z.number().min(0).default(44),
          poor: z.number().min(0).default(68),
        })
        .prefault({}),
      /** 样本足够且保留率低于这个值时，在报告里建议从 topics.yaml 移出（不会自动删除） */
      suggest_remove: z
        .object({
          min_samples: z.number().int().min(1).default(20),
          max_keep_rate: z.number().min(0).max(1).default(0.05),
        })
        .prefault({}),
    })
    .prefault({}),
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

/** 低质账号的采集间隔超过补收天数时，中间的内容会丢，提前报错 */
function checkCrawl(c: CrawlConfig): string | null {
  const longest = Math.max(...Object.values(c.account_quality.interval_hours));
  if (longest >= c.catch_up_days * 24) {
    return `account_quality.interval_hours 最长 ${longest} 小时，需要小于 catch_up_days（${c.catch_up_days} 天 = ${c.catch_up_days * 24} 小时），否则轮转期间的内容会丢失`;
  }
  return null;
}

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

/**
 * 推文实际归属的主题：评审时定的主题（旧 id 按 aliases 映射）；
 * 已不存在的主题（例如早期试跑用的示例主题）退回到账号在 topics.yaml 里的第一个主题。
 */
export function effectiveTopicId(config: Pick<AppConfig, "topics" | "topicAliases" | "accountTopics">, topicId: string | null | undefined, handle: string): string | undefined {
  return resolveTopicId(config, topicId) ?? config.accountTopics.get(handle.toLowerCase())?.[0];
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
  const crawlProblem = checkCrawl(crawlParsed.data);
  if (crawlProblem) throw new Error(`${crawlPath} 配置有误：${crawlProblem}`);

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
