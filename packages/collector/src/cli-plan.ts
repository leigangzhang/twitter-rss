import { loadConfig, loadDotEnv, localDate } from "@xrss/core";
import { createDb, migrateDb } from "@xrss/core/db";
import { loadState } from "./health.ts";
import { buildPlan, writePlan } from "./plan.ts";
import { TIER_LABELS } from "./quality.ts";
import { counts, loadPlan, loadProgress } from "./runner.ts";

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

loadDotEnv();

// 生成今天的采集清单 data/inbox/<date>/plan.json，交给 Browser Skill 按清单采集。
// 冷却期、人工暂停或不在允许时段时，清单里 skip 不为空，并以退出码 3 结束。
const config = loadConfig();

// 今天的采集已经开始、还没结束（比如中途断网暂停后重新运行每日任务）：沿用原来的清单，不重新生成，
// 否则新清单会和进行到一半的进度对不上
const today = localDate(new Date(), config.digest.timezone);
const running = loadProgress(today);
const existing = loadPlan(today);
if (running && existing && !existing.skip) {
  if (running.stopped) {
    // 已因异常停止：保留原清单（不覆盖成"今天不采集"），方便确认是本机原因后用 crawl:resume 接着采
    console.warn(
      `今天的采集已因异常停止（@${running.stopped.handle} ${running.stopped.status}）。` +
        `如果是本机断网、代理没开等原因，恢复网络后运行 pnpm crawl:resume，再重新运行每日任务；否则今天不再采集`,
    );
    process.exit(3);
  }
  if (running.phase !== "finished") {
    const c = counts(running);
    console.log(`今天的采集已在进行中（账号 ${c.accountsDone}/${c.accounts}），沿用原来的清单，继续运行 pnpm crawl next`);
    process.exit(0);
  }
}

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
  const catchUp = plan.accounts.filter((a) => a.since < plan.since).length;
  const tiers = [...groupBy(plan.accounts, (a) => TIER_LABELS[a.tier])]
    .map(([k, v]) => `${k} ${v.length}`)
    .join("，");
  console.log(`安排 ${plan.accounts.length} 个账号（${tiers}），采集 ${plan.contentDate} 发布的推文（${plan.since} ~ ${plan.until}）`);
  if (catchUp > 0) console.log(`其中 ${catchUp} 个账号上次没轮到，补收之前几天的内容（最多 ${config.crawl.catch_up_days} 天）`);
  console.log(`开始前先等待约 ${minutes} 分钟；本次最多打开 ${plan.budget.maxPageLoads} 个页面，其中详情页 ${plan.budget.maxDetail} 个`);
  if (plan.deferred.length > 0) {
    const byReason = groupBy(plan.deferred, (d) => d.reason);
    console.log(`本次未安排 ${plan.deferred.length} 个账号：`);
    for (const [reason, list] of byReason) console.log(`  ${reason}：${list.map((d) => `@${d.handle}`).join(" ")}`);
  }
}
