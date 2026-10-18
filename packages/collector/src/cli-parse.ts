import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type InboxFile, loadConfig, localDate } from "@xrss/core";
import { parseXGraphQL } from "./parsers/x-graphql.ts";
import { inboxDir } from "./paths.ts";

/**
 * 把 Browser Skill 抓到的原始网络响应转成标准采集文件。
 * 用法：pnpm --filter @xrss/collector parse --handle someone resp1.json resp2.json [--date 2026-10-18]
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    handle: { type: "string" },
    date: { type: "string" },
    source: { type: "string", default: "tencent-browser-skill" },
  },
});

if (!values.handle || positionals.length === 0) {
  console.error("用法：parse --handle <账号> <响应文件...> [--date YYYY-MM-DD]");
  process.exit(1);
}

const config = loadConfig();
const date = values.date ?? localDate(new Date(), config.digest.timezone);
// pnpm --filter 会切换到包目录运行，相对路径按执行命令时的目录解析
const baseDir = process.env.INIT_CWD ?? process.cwd();
const responses = positionals.map((p) => JSON.parse(readFileSync(resolve(baseDir, p), "utf8")) as unknown);
const { tweets, skipped } = parseXGraphQL(responses, values.handle);

const file: InboxFile = {
  source: values.source!,
  collectedAt: new Date().toISOString(),
  handle: values.handle.toLowerCase(),
  status: "ok",
  tweets,
};
const dir = inboxDir(date);
mkdirSync(dir, { recursive: true });
const out = join(dir, `${file.handle}.json`);
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`已写入 ${out}：${tweets.length} 条推文${skipped.length ? `，跳过 ${skipped.length} 条` : ""}`);
for (const s of skipped) console.warn(`  跳过 ${s.id ?? "?"}：${s.reason}`);
