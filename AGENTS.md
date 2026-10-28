# 项目说明（给开发用的 AI Agent）

这份说明给在这个仓库里**改代码、改文档**的 Agent（Claude Code 通过 `CLAUDE.md` 读到同一份）。
被要求运行每日任务、采集 X 时，不按这份做，改按 [agents/AGENTS.md](agents/AGENTS.md)。

## 项目

精选晨报：采集 X（原 Twitter）博主前一天的推文，用大模型精选、翻译后发邮件给订阅者，同时提供 RSS 和订阅页。

pnpm monorepo，Node.js 22+：

| 位置 | 内容 |
|---|---|
| `packages/core` | 数据格式、配置校验、数据库、打分和选稿、邮件和 RSS 共用的卡片视图 |
| `packages/collector` | 采集清单、逐步采集（`crawl next / done`）、脚本采集（`crawl:auto`）、X 数据解析 |
| `packages/pipeline` | 入库、AI 评审和摘要（`src/ai.ts`，同时支持 Anthropic 和 OpenAI 接口格式）、终审、发信、命令行工具 |
| `packages/emails` | 邮件模板（React Email） |
| `apps/web` | Next.js 订阅页、RSS、管理后台 |
| `config/` | 主题和博主、精选规则、采集节流；`config/curation.md` 原样进评审提示词，改它会改变评审结果 |
| `scripts/` | 脚本版每日任务（`daily-auto.sh`、`daily.sh`、`net-check.sh`）、常驻网站（`web.sh`） |
| `agents/` | 定时任务用的 Agent 规则、提示词、启动脚本和 launchd 配置 |

代码结构和改动清单见 [docs/maintenance/development.md](docs/maintenance/development.md)。

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 所有单元测试（vitest） |
| `pnpm typecheck` | 类型检查 |
| `pnpm build` | 构建网站 |
| `pnpm pipeline:dry` | 试跑流水线，不发邮件（没有 API Key 时加 `--skip-ai`） |
| `pnpm email:preview` | 用示例数据渲染邮件 |

提交前跑 `pnpm test` 和 `pnpm typecheck`。

## 改动时要做的事

- 改了采集数据格式：运行 `pnpm schema`。
- 改了表结构：运行 `pnpm --filter @xrss/core db:generate` 生成迁移。
- 改了功能：同步更新 [docs/](docs/README.md) 里对应主题的文档（功能、调度、维护）。
- 摘要字数阈值只改 `packages/core/src/view.ts` 的 `READER_SUMMARY_MIN_CHARS`。

## 开发时不要做的事

- 不读取或输出 `.env` 里的密钥。
- 没被要求时，不运行会访问 X 的命令（`pnpm plan`、`pnpm crawl*`、`scripts/daily-auto.sh`），不运行会真的发邮件的命令（`pnpm pipeline`、`scripts/daily.sh` 不带 `--dry-run`、`pnpm resend`、`pnpm email:test`、`pnpm notify`）。
- 不手工编辑 `data/` 下的运行数据，尤其是 `data/inbox/<日期>/` 的 `plan.json`、`progress.json`、`detail-needed.json`。
- launchd 正在用 `scripts/daily-auto.sh`、`scripts/web.sh` 的路径，移动或改名它们时要同步改 `agents/*.plist` 并提醒重新安装。
