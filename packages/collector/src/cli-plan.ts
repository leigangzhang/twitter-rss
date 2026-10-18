import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { buildPlan, writePlan } from "./plan.ts";

loadDotEnv();

// 生成今天的采集清单 data/inbox/<date>/plan.json，交给 Browser Skill 按清单采集
const config = loadConfig();
const db = createDb();
await migrateDb(db);
const plan = await buildPlan(config, db);
const path = writePlan(plan);
console.log(`采集清单：${path}`);
console.log(`共 ${plan.accounts.length} 个账号，采集 ${plan.contentDate} 发布的推文（${plan.since} ~ ${plan.until}）`);
