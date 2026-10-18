import { loadConfig, loadDotEnv } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { loadAccountQuality, renderAccountReport } from "./quality.ts";

loadDotEnv();

// 查看账号质量分档：pnpm accounts
const config = loadConfig();
const db = createDb();
await migrateDb(db);
console.log(renderAccountReport(await loadAccountQuality(db, config), config));
