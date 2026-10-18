import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { engagement, InboxFile, loadConfig, loadDotEnv, localDate } from "@xrss/core";
import { type DetailCandidate, scheduleDetails } from "./details.ts";
import { loadState, recordRun, saveState } from "./health.ts";
import { readInbox } from "./inbox.ts";
import { detailTargets, parseXGraphQL } from "./parsers/x-graphql.ts";
import { inboxDir } from "./paths.ts";
import type { CrawlPlan } from "./plan.ts";
import { createRandom } from "./random.ts";

loadDotEnv();

/**
 * 把 Browser Skill 抓到的原始网络响应转成标准采集文件 data/inbox/<日期>/<handle>.json，
 * 在预算内安排需要打开详情页补抓的推文（detail-needed.json），并记录本次采集的用量和异常。
 *
 *   pnpm --filter @xrss/collector parse                     处理 raw/ 下所有账号（按文件名 <handle>-*.json 分组）
 *   pnpm --filter @xrss/collector parse --handle someone a.json b.json
 *   可加 --date 2026-10-18
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    handle: { type: "string" },
    date: { type: "string" },
    source: { type: "string", default: "tencent-browser-skill" },
  },
});

const config = loadConfig();
const date = values.date ?? localDate(new Date(), config.digest.timezone);
const dir = inboxDir(date);
// pnpm --filter 会切换到包目录运行，相对路径按执行命令时的目录解析
const baseDir = process.env.INIT_CWD ?? process.cwd();

const planPath = join(dir, "plan.json");
const plan: CrawlPlan | undefined = existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) : undefined;
const inRange = (iso: string) => !plan?.until || (iso >= plan.since && iso < plan.until);

/** handle → 响应文件 */
const groups = new Map<string, string[]>();
const rawDir = join(dir, "raw");
if (values.handle) {
  if (positionals.length === 0) {
    console.error("用法：parse --handle <账号> <响应文件...>，或不带参数处理 raw/ 下所有文件");
    process.exit(1);
  }
  groups.set(values.handle.toLowerCase(), positionals.map((p) => resolve(baseDir, p)));
} else if (existsSync(rawDir)) {
  for (const name of readdirSync(rawDir).sort()) {
    const m = /^([A-Za-z0-9_]{1,15})-.+\.json$/.exec(name);
    if (!m) continue;
    const h = m[1]!.toLowerCase();
    groups.set(h, [...(groups.get(h) ?? []), join(rawDir, name)]);
  }
}

const candidates: DetailCandidate[] = [];
for (const [handle, files] of groups) {
  const responses = files.map((p) => JSON.parse(readFileSync(p, "utf8")) as unknown);
  const { tweets, skipped } = parseXGraphQL(responses, handle);

  // 采集端已经写过异常状态（如采到一半被限流）时保留状态，只补上解析出的推文
  const outPath = join(dir, `${handle}.json`);
  let previous: InboxFile | undefined;
  if (existsSync(outPath)) {
    const parsed = InboxFile.safeParse(JSON.parse(readFileSync(outPath, "utf8")));
    if (parsed.success) previous = parsed.data;
  }
  const keepStatus = previous && previous.status !== "ok";
  const file: InboxFile = {
    source: values.source!,
    collectedAt: new Date().toISOString(),
    handle,
    status: keepStatus ? previous!.status : "ok",
    error: keepStatus ? previous!.error : undefined,
    tweets,
  };
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);

  const inRangeTweets = tweets.filter((t) => inRange(t.createdAt));
  const targets = detailTargets(inRangeTweets);
  const byId = new Map(tweets.map((t) => [t.id, t]));
  for (const t of targets) candidates.push({ ...t, handle, engagement: engagement(byId.get(t.id)!) });
  console.log(
    `@${handle}：${tweets.length} 条（时间范围内 ${inRangeTweets.length} 条）${targets.length ? `，${targets.length} 条需要补抓详情` : ""}${file.status !== "ok" ? `，采集状态 ${file.status}` : ""}${skipped.length ? `，跳过 ${skipped.length} 条` : ""}`,
  );
  for (const s of skipped) console.warn(`  跳过 ${s.id ?? "?"}：${s.reason}`);
}

// 用量：主页按账号计（同一主页滚动产生的多个响应算一次打开），详情页按文件计
const rawNames = existsSync(rawDir) ? readdirSync(rawDir).filter((n) => n.endsWith(".json")) : [];
const detailPages = rawNames.filter((n) => n.includes("-detail-")).length;
const timelinePages = new Set(rawNames.filter((n) => !n.includes("-detail-")).map((n) => n.split("-")[0]!.toLowerCase())).size;

// 在剩余预算内安排补抓
const crawl = config.crawl;
const maxDetail = plan?.budget?.maxDetail ?? crawl.budget.max_detail_per_run;
const maxPages = plan?.budget?.maxPageLoads ?? crawl.budget.max_page_loads_per_run;
const remaining = Math.max(0, Math.min(maxDetail - detailPages, maxPages - timelinePages - detailPages));
const { scheduled, overBudget } = scheduleDetails(candidates, remaining, crawl, createRandom());

// 记录本次采集结果；遇到异常时进入冷却
const inbox = readInbox(date);
const state = recordRun(
  loadState(),
  { date, files: inbox.files.map((f) => ({ handle: f.handle, status: f.status, error: f.error })), timelinePages, detailPages },
  crawl,
);
saveState(state);

const blocked = inbox.files.filter((f) => f.status !== "ok");
const neededPath = join(dir, "detail-needed.json");
writeFileSync(
  neededPath,
  `${JSON.stringify(
    {
      date,
      generatedAt: new Date().toISOString(),
      // 采集端出现异常时不再补抓
      stop: blocked.length > 0 ? `采集出现异常（${blocked.map((b) => `@${b.handle}: ${b.status}`).join("，")}），今天不要再打开任何页面` : null,
      used: { timelinePages, detailPages, maxPageLoads: maxPages, maxDetail },
      total: blocked.length > 0 ? 0 : scheduled.length,
      scheduled: blocked.length > 0 ? [] : scheduled,
      overBudget,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n用量：主页 ${timelinePages}，详情页 ${detailPages}（上限 ${maxPages} 个页面，其中详情页 ${maxDetail}）`);
if (blocked.length > 0) {
  console.warn(`⚠ 采集异常：${blocked.map((b) => `@${b.handle} ${b.status}`).join("，")}`);
  console.warn(state.manualHold ? `已暂停采集：${state.manualHold.reason}` : `进入冷却，${state.cooldownUntil} 之前不再安排采集`);
} else if (scheduled.length > 0) {
  console.log(`需要补抓详情页：${scheduled.length} 条（清单：${neededPath}）${overBudget.length ? `，另有 ${overBudget.length} 条超出预算` : ""}`);
} else {
  console.log(`没有需要补抓的详情页${overBudget.length ? `（${overBudget.length} 条超出预算未安排）` : ""}`);
}
