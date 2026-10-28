# 项目说明（给 AI Agent）

精选晨报：采集 X（原 Twitter）博主前一天的推文，用大模型精选、翻译后发邮件给订阅者，同时提供 RSS 和订阅页。
pnpm monorepo：`packages/core`（数据格式、配置、数据库）、`packages/collector`（采集清单与逐步采集）、
`packages/pipeline`（入库、AI 评审、发信；大模型接口同时支持 Anthropic 和 OpenAI 格式，见 `src/ai.ts`）、`packages/emails`（邮件模板）、`apps/web`（Next.js 订阅页与管理页）。

## 每日任务

每天的定时任务是脚本版：launchd 每天 08:00 运行 `scripts/daily-auto.sh`（`pnpm crawl:auto` 采集，不需要 Agent），见 [docs/scheduling/script-mode.md](docs/scheduling/script-mode.md)。
被要求由 Agent "运行每日任务""采集并发送今天的精选"时（备用方式），严格按 [agents/daily-task.md](agents/daily-task.md) 执行，
采集循环的细节见 [packages/collector/AGENT_PROMPT.md](packages/collector/AGENT_PROMPT.md)。

## 采集规则（必须遵守）

- 采集范围、顺序和等待时间由 `pnpm -s crawl next` 决定。不自己挑账号、减少账号、跳过等待或合并步骤。
- 只浏览：不点赞、不转发、不关注、不回复、不发帖，不打开清单以外的页面。
- 遇到限流、验证码、登录失效立即用 `pnpm -s crawl done <key> --status ...` 报告并停止，不重试、不绕过。
- 不改浏览器指纹、不用代理、不切换账号、不处理验证码。
- 不手工编辑 `data/inbox/<日期>/` 下的 `plan.json`、`progress.json`、`detail-needed.json`。
- 不读取或输出 `.env` 里的密钥。

## 开发

| 命令 | 作用 |
|---|---|
| `pnpm test` | 所有单元测试（vitest） |
| `pnpm typecheck` | 类型检查 |
| `pnpm build` | 构建网站 |
| `pnpm pipeline:dry` | 试跑流水线，不发邮件 |
| `pnpm email:preview` | 用示例数据渲染邮件 |

修改采集数据格式后运行 `pnpm schema`；修改表结构后运行 `pnpm --filter @xrss/core db:generate`。
详细说明按主题放在 [docs/](docs/README.md)（功能、调度、维护）；改了功能时同步更新对应的那一篇。
