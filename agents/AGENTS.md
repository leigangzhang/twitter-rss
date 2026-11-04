# 定时任务 Agent 的规则

这份说明给**运行每日任务**的 Agent（Agent 版每日任务，备用方式）。开发、改代码时看根目录的 [AGENTS.md](../AGENTS.md)。

默认的每日任务是脚本版：launchd 每天 08:00 运行 `scripts/daily-auto.sh`（`pnpm crawl:auto` 采集），不需要 Agent，
见 [docs/scheduling/script-mode.md](../docs/scheduling/script-mode.md)。两种方式共用同一份清单和进度，同一天不要同时运行。

## 要做什么

1. 严格按 [daily-task.md](daily-task.md) 执行每日任务（所有命令都在仓库根目录运行）。
2. 采集循环的细节见 [crawl-loop.md](crawl-loop.md)。

## 采集规则（必须遵守）

- 采集范围、顺序和等待时间由 `pnpm -s crawl next` 决定。不自己挑账号、减少账号、跳过等待或合并步骤。
- 只浏览：不点赞、不转发、不关注、不回复、不发帖，不打开清单以外的页面。
- 遇到限流、验证码、登录失效立即用 `pnpm -s crawl done <key> --status ...` 报告并停止，不重试、不绕过。
- 不改浏览器指纹、不用代理、不切换账号、不处理验证码。
- 不手工编辑 `data/inbox/<日期>/` 下的 `plan.json`、`progress.json`、`detail-needed.json`。
- 不读取或输出 `.env` 里的密钥。
- 不修改仓库里的代码、配置和文档；发现问题写进汇报，由人处理。

## 本目录的文件

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | 本文件：定时任务 Agent 的规则 |
| `daily-task.md` | 每日任务提示词，`agent-run.sh` 读取其中的 `text` 代码块；DeepSeek Harness 等把它整段粘贴进去 |
| `crawl-loop.md` | Agent 采集循环：`crawl next / done`、保存网络响应、从页面读取、必须停止的情况 |
| `agent-run.sh` | 让命令行 Agent 无人值守跑一次每日任务：`agents/agent-run.sh claude` 或 `codex` |
| `com.xrss.daily.plist` | Agent 版的 launchd 定时（每天 06:30 运行 `agents/agent-run.sh`） |
| `com.xrss.auto.plist` | 脚本版的 launchd 定时（每天 08:00 运行 `scripts/daily-auto.sh`，默认） |
| `com.xrss.web.plist` | 网站常驻运行（`scripts/web.sh`） |

接入方式和常见问题见 [docs/scheduling/agent-mode.md](../docs/scheduling/agent-mode.md)。
