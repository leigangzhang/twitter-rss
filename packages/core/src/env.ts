import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./config.ts";

/** .env 里的这些变量优先于系统环境变量，避免系统里残留的旧密钥覆盖 */
export const DOTENV_OVERRIDES: readonly string[] = ["LLM_API_KEY"];

/**
 * 读取仓库根目录的 .env（如果存在），已存在的环境变量不会被覆盖（DOTENV_OVERRIDES 除外）。
 * 同一个变量在 .env 里写了多次时，以第一次为准。
 * 命令行脚本和网站都从这里拿 LLM_API_KEY、SMTP_PASS 等配置。
 */
export function loadDotEnv(path?: string): void {
  let file = path;
  if (!file) {
    try {
      file = join(findRepoRoot(), ".env");
    } catch {
      return;
    }
  }
  if (!existsSync(/*turbopackIgnore: true*/ file)) return;
  const seen = new Set<string>();
  for (const line of readFileSync(/*turbopackIgnore: true*/ file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (process.env[key] === undefined || DOTENV_OVERRIDES.includes(key)) process.env[key] = value;
  }
}
