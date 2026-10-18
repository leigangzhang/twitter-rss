import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "../src/config.ts";
import { InboxFile } from "../src/types.ts";

const schema = z.toJSONSchema(InboxFile, { io: "input" });
const out = join(findRepoRoot(), "schemas", "inbox-file.schema.json");
writeFileSync(out, `${JSON.stringify({ title: "X 采集输出（每个账号一个文件）", ...schema }, null, 2)}\n`);
console.log(`已写入 ${out}`);
