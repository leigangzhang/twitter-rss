import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { loadState } from "./health.ts";
import { buildPlan, writePlan } from "./plan.ts";

loadDotEnv();

// 生成今天的采集清单 data/inbox/<date>/plan.json，交给 Browser Skill 按清单采集。
// 冷却期、人工暂停或不在允许时段时，清单里 skip 不为空，并以退出码 3 结束。
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const plan = await buildPlan(config, db, loadState());
const path = writePlan(plan);
console.log(`采集清单：${path}`);

if (plan.skip) {
  console.warn(`今天不采集：${plan.skip.reason}${plan.skip.until ? `（到 ${plan.skip.until}）` : ""}`);
  process.exitCode = 3;
} else {
  const minutes = Math.round(plan.startDelaySec / 60);
  console.log(`安排 ${plan.accounts.length} 个账号，采集 ${plan.contentDate} 发布的推文（${plan.since} ~ ${plan.until}）`);
  console.log(`开始前先等待约 ${minutes} 分钟；本次最多打开 ${plan.budget.maxPageLoads} 个页面，其中详情页 ${plan.budget.maxDetail} 个`);
  if (plan.deferred.length > 0) console.log(`本次未安排 ${plan.deferred.length} 个账号：${plan.deferred.map((d) => `@${d.handle}（${d.reason}）`).join("，")}`);
}
