import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "@xrss/core";
import { GMAIL_CLIP_BYTES, renderDigest } from "./index.ts";
import { sampleDigest } from "./sample.ts";

// 用示例数据渲染两种语言的邮件，输出到 data/out/，用浏览器打开查看
const outDir = join(findRepoRoot(), "data", "out");
mkdirSync(outDir, { recursive: true });

for (const lang of ["zh", "orig"] as const) {
  const email = await renderDigest(sampleDigest(lang));
  const path = join(outDir, `preview-${lang}.html`);
  writeFileSync(path, email.html);
  const kb = Buffer.byteLength(email.html) / 1024;
  console.log(`${path}（${kb.toFixed(1)} KB${kb * 1024 > GMAIL_CLIP_BYTES ? "，超过 Gmail 截断阈值" : ""}）`);
  console.log(`  标题：${email.subject}`);
}
