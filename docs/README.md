# 文档目录

首页 [README](../README.md) 讲这个项目是什么、怎么用起来。这里按主题列出各部分的细节，改了代码时同步更新对应的那一篇。

## 功能：每天发生了什么

| 文档 | 内容 |
|---|---|
| [采集](features/collection.md) | 脚本采集和 Agent 采集、采集数据格式、长推文全文、单个账号出错的处理 |
| [AI 精选](features/curation.md) | 规则粗筛、AI 初审、编辑终审、评分和选稿、阅读摘要、外部文章摘要、原文版摘要、精选报告 |
| [邮件与 RSS](features/email.md) | 邮件版式、中文版和原文版、条数和分卷、合并发送、管理员提醒、RSS |
| [订阅页与管理后台](features/web-admin.md) | 订阅页、订阅者管理、推送历史与重新推送、赞 / 踩反馈 |

## 调度：每天怎么自动跑

| 文档 | 内容 |
|---|---|
| [脚本版每日任务（默认）](scheduling/script-mode.md) | 采集专用的 Chrome、试采、WireGuard 网络自检、launchd 定时、退出码和异常处理 |
| [Agent 版每日任务（备用）](scheduling/agent-mode.md) | Browser Skill、Claude Code / Codex / DeepSeek Harness 接入、定时方式 |
| [每日任务提示词](../agents/daily-task.md) | 交给 Agent 的提示词（`scripts/agent-run.sh` 直接读取这份） |
| [Agent 采集循环](../packages/collector/AGENT_PROMPT.md) | Agent 版里 `crawl next / done` 循环的细节 |

## 性能：节流、额度与容量

| 文档 | 内容 |
|---|---|
| [节流、额度与容量](performance/limits.md) | 采集预算和节奏、X 接口额度、限流熔断和冷却、账号分档轮转、AI 评审量、邮件大小和发信节奏 |

## 维护：配置、运维、上线、开发

| 文档 | 内容 |
|---|---|
| [配置参考](maintenance/configuration.md) | `config/` 下每个文件、`.env` 全部变量、换大模型 |
| [日常运维](maintenance/operations.md) | 日志、状态命令、常见问题处理、根据反馈调整精选标准、账号维护 |
| [上线部署](maintenance/deployment.md) | 本机常驻 + Cloudflare Tunnel、部署到云端、发信邮箱 |
| [开发](maintenance/development.md) | 代码结构、常用命令、改数据格式和表结构时要做的事 |
