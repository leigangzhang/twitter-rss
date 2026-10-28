# 文档目录

首页 [README](../README.md) 讲这个项目是什么、怎么用起来。这里按主题列出各部分的细节，改了代码时同步更新对应的那一篇。

## 功能：每天发生了什么

| 文档 | 内容 |
|---|---|
| [默认博主](features/accounts.md) | 5 个主题和 100 个账号的完整名单，账号内容质量管理（自动分档、建议移出、账号降权），怎么增删账号、调整主题，同步自己 X 账号的关注列表 |
| [采集](features/collection.md) | 脚本采集和 Agent 采集、采集数据格式、长推文全文、采集预算和节奏、账号分档轮转、X 接口额度、限流熔断和冷却 |
| [AI 精选](features/curation.md) | 规则粗筛、AI 初审、编辑终审、人工反馈、评分和选稿、阅读摘要、外部文章摘要、原文版摘要、精选报告、AI 用量 |
| [邮件与 RSS](features/email.md) | 邮件版式、中文版和原文版、条数和分卷、合并发送和发信节奏、管理员提醒、RSS |
| [订阅页与管理后台](features/web-admin.md) | 订阅页、管理后台：账号管理（增删账号、看账号质量、调权重、同步关注）、订阅管理、邮件推送与重新推送、RSS 订阅统计、赞 / 踩反馈 |

## 调度：每天怎么自动跑

| 文档 | 内容 |
|---|---|
| [脚本版每日任务（默认）](scheduling/script-mode.md) | 采集专用的 Chrome、试采、WireGuard 网络自检、launchd 定时、退出码和异常处理 |
| [Agent 版每日任务（备用）](scheduling/agent-mode.md) | Browser Skill、Claude Code / Codex / DeepSeek Harness 接入、定时方式 |
| [定时任务 Agent 的规则](../agents/AGENTS.md) | 运行每日任务的 Agent 必须遵守的规则，以及 `agents/` 下每个文件的作用 |
| [每日任务提示词](../agents/daily-task.md) | 交给 Agent 的提示词（`agents/agent-run.sh` 直接读取这份） |
| [Agent 采集循环](../agents/crawl-loop.md) | Agent 版里 `crawl next / done` 循环的细节 |

## 维护：配置、运维、上线、开发

| 文档 | 内容 |
|---|---|
| [配置参考](maintenance/configuration.md) | `config/` 下每个文件、`.env` 全部变量、换大模型 |
| [日常运维](maintenance/operations.md) | 日志、状态命令、常见问题处理、根据反馈调整精选标准、账号维护 |
| [上线部署](maintenance/deployment.md) | 本机常驻 + Cloudflare Tunnel、部署到云端、发信邮箱 |
| [开发](maintenance/development.md) | 代码结构、常用命令、改数据格式和表结构时要做的事 |
