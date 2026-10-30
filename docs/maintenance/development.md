# 开发

pnpm monorepo，Node.js 22+。改了代码时，把对应主题的文档一起更新（目录见 [docs/README.md](../README.md)）。

## 代码结构

| 位置 | 内容 |
|---|---|
| `packages/core` | 数据格式（采集契约 `types.ts`）、配置校验（`config.ts`）、后台改配置文件（`config-edit.ts`，只改涉及的行、保留注释）、`.env` 读取（`env.ts`）、数据库表和查询（`db/`，含反馈 `db/feedback.ts`）、打分（`scoring.ts`）、选稿（`select.ts`）、邮件和 RSS 共用的卡片视图（`view.ts`） |
| `packages/collector` | 采集清单（`plan.ts`）、逐步采集（`runner.ts`，`crawl next / done`）、脚本采集（`cli-auto.ts`、`browser/`）、X 网页数据解析（`parsers/`）、账号分档（`quality.ts`）、同步关注（`follows.ts`、`cli-follows.ts`） |
| `packages/pipeline` | 每日流水线（`daily.ts`）：入库（`ingest.ts`）、挑候选（`candidates.ts`）、AI 评审和摘要（`ai.ts`，Anthropic / OpenAI 两种格式）、终审（`editorial.ts`）、外部文章（`links.ts`）、发信（`digest.ts`、`delivery.ts`、`mailer.ts`）、后台预览（`admin-preview.ts`）和各个命令行工具（`cli-*.ts`） |
| `packages/emails` | 邮件模板（React Email）：每日精选、确认、管理链接、设置变更通知 |
| `apps/web` | Next.js 订阅页、偏好管理、退订、RSS、管理后台（账号、订阅者、邮件推送、RSS 订阅统计、反馈） |
| `config/` | 主题和博主、精选规则、采集节流、精选标准，见 [配置参考](configuration.md) |
| `schemas/inbox-file.schema.json` | 采集输出的 JSON Schema（`pnpm schema` 生成） |
| `scripts/` | `daily-auto.sh`（脚本版每日任务）、`daily.sh`（采集后的处理和发信）、`net-check.sh`（WireGuard 自检）、`web.sh`（常驻网站）、`dev.command`（双击启动本地服务） |
| `agents/` | 定时任务相关：Agent 规则（`AGENTS.md`）、每日任务提示词、Agent 采集循环、`agent-run.sh`、launchd 配置，见 [agents/AGENTS.md](../../agents/AGENTS.md) |
| `AGENTS.md` / `CLAUDE.md` | 给开发用的 AI Agent 的项目说明（`CLAUDE.md` 只引用 `AGENTS.md`） |
| `data/` | 本机数据（不提交）：数据库 `app.db`、收件箱 `inbox/`、输出 `out/`、日志 `logs/`、采集状态 `crawl-state.json` |

## 本地开发

```bash
pnpm install
cp .env.example .env     # 可以先留空试跑
pnpm db:migrate          # 建表
pnpm email:preview       # 用示例数据渲染邮件 → data/out/preview-zh.html
pnpm dev                 # 订阅页 http://localhost:3000
pnpm pipeline:dry        # 试跑流水线，不发邮件（没有 API Key 时加 --skip-ai 用规则分）
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` / `pnpm typecheck` | 所有单元测试（vitest）/ 类型检查 |
| `pnpm build` | 构建网站 |
| `pnpm pipeline:dry [--rereview]` | 试跑流水线，不发邮件（`--rereview` 按新标准重评） |
| `pnpm pipeline` / `scripts/daily.sh [--dry-run]` | 正式运行流水线 / 带日志的完整处理 |
| `pnpm email:preview` / `pnpm email:test --to 邮箱` | 用示例数据渲染邮件 / 用真实内容发测试邮件 |
| `pnpm preview:snapshot` | 重新生成订阅页的邮件示例 |
| `pnpm plan` | 生成今天的采集清单 |
| `pnpm crawl:chrome` / `pnpm crawl:auto [--trial N]` | 打开采集专用的 Chrome / 按清单脚本采集 |
| `pnpm crawl next` / `pnpm crawl done <key>` | Agent 版逐步采集 |
| `pnpm crawl progress` / `pnpm crawl:status` | 采集进度 / 冷却期、最近异常和用量 |
| `pnpm crawl:reset` / `pnpm crawl:resume` | 重新登录后解除暂停 / 解除冷却并从出错的那一步接着采 |
| `pnpm accounts` | 账号分档 |
| `pnpm review:backfill` | 补评审旧推文，只用于重算保留率 |
| `pnpm follows:sync [--dry-run]` | 把 X 关注列表同步进 `topics.yaml` |
| `pnpm subscribers` / `pnpm resend` / `pnpm notify` / `pnpm feedback` | 订阅者 / 推送历史和重新推送 / 给管理员发提醒 / 赞踩反馈 |
| `scripts/daily-auto.sh` | 完整的每日任务（launchd 每天 08:00 调用） |

## 改动时要做的事

| 改了什么 | 要做什么 |
|---|---|
| 采集数据格式（`packages/core/src/types.ts` 里的 `RawTweet` 等） | `pnpm schema` 重新生成 JSON Schema |
| 数据库表（`packages/core/src/db/schema.ts`） | `pnpm --filter @xrss/core db:generate` 生成迁移，`pnpm db:migrate` 执行 |
| 评审提示词或 `config/curation.md` | `pnpm pipeline:dry --rereview` 对比精选报告 |
| 摘要的字数阈值 | 只改 `packages/core/src/view.ts` 的 `READER_SUMMARY_MIN_CHARS`，提示词、评审整理和邮件模板共用 |
| 邮件模板 | `pnpm email:preview` 看效果，`pnpm email:test` 在真实邮箱里确认 |
| 网站 | `pnpm build`；已上线时重启 `com.xrss.web`（见 [上线部署](deployment.md)） |
| 任何功能 | 更新 `docs/` 里对应主题的文档 |
