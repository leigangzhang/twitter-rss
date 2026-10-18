import { loadConfig, loadDotEnv } from "@xrss/core";
import { checkGate, loadState, resetState, saveState, statePath } from "./health.ts";

loadDotEnv();

/**
 *   pnpm crawl:status   查看采集健康状态：冷却期、暂停原因、最近异常和用量
 *   pnpm crawl:reset    人工确认 X 账号正常（如已重新登录）后，解除暂停和冷却
 */
const command = process.argv[2];
const config = loadConfig();
const state = loadState();

if (command === "reset") {
  saveState(resetState(state));
  console.log("已解除暂停和冷却，下次 pnpm plan 会正常安排采集");
  process.exit(0);
}

const gate = checkGate(state, config.crawl, config.digest.timezone);
console.log(`状态文件：${statePath()}`);
console.log(gate.ok ? "现在可以采集" : `现在不采集：${gate.reason}${gate.until ? `（到 ${gate.until}）` : ""}`);
console.log(`连续异常次数：${state.consecutiveIncidents}`);

const incidents = state.incidents.slice(-5).reverse();
if (incidents.length > 0) {
  console.log("\n最近的异常：");
  for (const i of incidents) {
    console.log(`  ${i.at}  @${i.handle}  ${i.status}${i.error ? `（${i.error}）` : ""}  冷却 ${i.cooldownHours === "manual" ? "需人工处理" : `${i.cooldownHours} 小时`}`);
  }
}

const runs = state.runs.slice(-7).reverse();
if (runs.length > 0) {
  console.log("\n最近的采集：");
  for (const r of runs) {
    console.log(`  ${r.date}  账号 ${r.accounts}  主页 ${r.timelinePages}  详情页 ${r.detailPages}${r.blocked ? `  异常 ${r.blocked}` : ""}`);
  }
}
