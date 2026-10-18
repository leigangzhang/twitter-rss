import { parseArgs } from "node:util";
import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { buildPreviewSnapshot, writePreviewSnapshot } from "./preview-snapshot.ts";

loadDotEnv();

/**
 * 把当前的优质内容保存为订阅页"邮件预览"的固定示例（apps/web/data/preview.json）。
 * 保存后订阅页不再随每天的数据变化；想换一批时再运行一次：
 *   pnpm preview:snapshot              最近 7 天，取 digest.yaml 里 total_items 条
 *   pnpm preview:snapshot --days 14 --count 8
 */
const { values } = parseArgs({ options: { days: { type: "string", default: "7" }, count: { type: "string" } } });
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const count = Number(values.count ?? config.digest.digest.total_items);
const snapshot = await buildPreviewSnapshot(db, config, { count, days: Number(values.days) });
if (snapshot.items.length === 0) {
  console.error("最近没有通过精选的推文，没有更新预览。可以加大 --days 或先跑一次流水线。");
  process.exit(1);
}
const path = writePreviewSnapshot(snapshot);
console.log(`已保存 ${snapshot.items.length} 条（${snapshot.periodLabel}）到 ${path}`);
for (const i of snapshot.items) console.log(`  ${i.quality} 分 · @${i.author.handle} · ${i.zh.text.slice(0, 40).replace(/\n/g, " ")}`);
