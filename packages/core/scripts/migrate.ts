import { loadDotEnv } from "../src/env.ts";
import { createDb, migrateDb } from "../src/db/index.ts";

loadDotEnv();
const db = createDb();
await migrateDb(db);
console.log("数据库表结构已是最新");
