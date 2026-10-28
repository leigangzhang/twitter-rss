# agents/

这个目录放每日任务和网站常驻要用到的 launchd 配置，以及交给 Agent 的提示词。使用说明都在 [docs/](../docs/README.md)。

| 文件 | 作用 | 说明 |
|---|---|---|
| `com.xrss.auto.plist` | 脚本版每日任务：每天 08:00 运行 `scripts/daily-auto.sh`（默认） | [脚本版每日任务](../docs/scheduling/script-mode.md) |
| `com.xrss.web.plist` | 网站常驻运行：`scripts/web.sh`（`next start`，`127.0.0.1:3000`） | [上线部署](../docs/maintenance/deployment.md) |
| `com.xrss.daily.plist` | Agent 版每日任务：每天 06:30 运行 `scripts/agent-run.sh`（备用） | [Agent 版每日任务](../docs/scheduling/agent-mode.md) |
| `daily-task.md` | 交给 Agent 的每日任务提示词，`scripts/agent-run.sh` 直接读取其中的 `text` 代码块 | [Agent 版每日任务](../docs/scheduling/agent-mode.md) |

脚本版和 Agent 版共用同一份清单和进度，同一天不要同时运行：启用其中一个时停用另一个的定时任务。
