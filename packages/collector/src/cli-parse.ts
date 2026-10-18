import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type InboxFile, loadConfig, localDate } from "@xrss/core";
import { type DetailTarget, detailTargets, parseXGraphQL } from "./parsers/x-graphql.ts";
import { inboxDir } from "./paths.ts";
import type { CrawlPlan } from "./plan.ts";

/**
 * 把 Browser Skill 抓到的原始网络响应转成标准采集文件 data/inbox/<日期>/<handle>.json，
 * 并列出需要打开详情页补抓的推文（detail-needed.json）。
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
if (values.handle) {
  if (positionals.length === 0) {
    console.error("用法：parse --handle <账号> <响应文件...>，或不带参数处理 raw/ 下所有文件");
    process.exit(1);
  }
  groups.set(values.handle.toLowerCase(), positionals.map((p) => resolve(baseDir, p)));
} else {
  const rawDir = join(dir, "raw");
  if (!existsSync(rawDir)) {
    console.error(`没有找到 ${rawDir}`);
    process.exit(1);
  }
  for (const name of readdirSync(rawDir).sort()) {
    const m = /^([A-Za-z0-9_]{1,15})-.+\.json$/.exec(name);
    if (!m) continue;
    const h = m[1]!.toLowerCase();
    groups.set(h, [...(groups.get(h) ?? []), join(rawDir, name)]);
  }
}

const needed: Record<string, DetailTarget[]> = {};
for (const [handle, files] of groups) {
  const responses = files.map((p) => JSON.parse(readFileSync(p, "utf8")) as unknown);
  const { tweets, skipped } = parseXGraphQL(responses, handle);

  const file: InboxFile = {
    source: values.source!,
    collectedAt: new Date().toISOString(),
    handle,
    status: "ok",
    tweets,
  };
  writeFileSync(join(dir, `${handle}.json`), `${JSON.stringify(file, null, 2)}\n`);

  const targets = detailTargets(tweets.filter((t) => inRange(t.createdAt)));
  if (targets.length > 0) needed[handle] = targets;
  const inRangeCount = tweets.filter((t) => inRange(t.createdAt)).length;
  console.log(
    `@${handle}：${tweets.length} 条（时间范围内 ${inRangeCount} 条）${targets.length ? `，${targets.length} 条需要补抓详情` : ""}${skipped.length ? `，跳过 ${skipped.length} 条` : ""}`,
  );
  for (const s of skipped) console.warn(`  跳过 ${s.id ?? "?"}：${s.reason}`);
}

const neededPath = join(dir, "detail-needed.json");
const total = Object.values(needed).reduce((n, l) => n + l.length, 0);
writeFileSync(neededPath, `${JSON.stringify({ date, generatedAt: new Date().toISOString(), total, targets: needed }, null, 2)}\n`);
console.log(total > 0 ? `\n需要补抓详情的推文清单：${neededPath}（${total} 条）` : "\n没有需要补抓详情的推文");
