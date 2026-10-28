# 配置参考

所有设置都是纯文本文件，改完下次运行生效（网站读取的配置要重启网站，见 [上线部署](deployment.md)）。每个文件里都有逐项注释，这里列出它们管什么、去哪篇文档看细节。

## `config/` 目录

| 文件 | 管什么 | 细节 |
|---|---|---|
| `topics.yaml` | 主题和博主（**只采集这里列出的账号**），主题名、颜色、说明；主题合并前的旧 ID 会跳转 | [采集](../features/collection.md) |
| `digest.yaml` | 时间范围、每期条数、每个主题每天送评审的条数、最低分、视频降权、账号权重、语言、外部文章、邮件大小和分卷、合并发送、订阅页、RSS | 见下表 |
| `crawl.yaml` | 采集预算、节奏、活跃时段、账号分档、异常后的冷却期 | [节流、额度与容量](../performance/limits.md) |
| `curation.md` | 精选标准：要什么、不要什么，原样放进给大模型的提示词 | [AI 精选](../features/curation.md#3-ai-初审逐条) |

`config/` 的位置可以用 `.env` 的 `CONFIG_DIR` 改。

### `digest.yaml` 各段

| 段 | 作用 | 细节 |
|---|---|---|
| `collect_window` / `window_hours` / `timezone` | 只取前一天，或最近 N 小时 | [AI 精选](../features/curation.md#1-时间范围和规则粗筛) |
| `digest` | `total_items`（60）、`min_per_topic`（1）、`candidates_per_topic`（30，按天） | [AI 精选](../features/curation.md#6-评分和选稿) |
| `filters` | 回复、纯转发、过短内容、`min_quality`（3） | [AI 精选](../features/curation.md) |
| `media_weight` / `video_mode` | 视频降权（0.6）、视频显示封面还是一行文字 | [邮件与 RSS](../features/email.md#版式) |
| `account_weight` | 个别账号的分数权重（默认 1，0–2），只影响排序；目前 `jinchenma_ai: 0.6` | [AI 精选](../features/curation.md#6-评分和选稿) |
| `thread` | 合并连续推文、最多显示几条 | [邮件与 RSS](../features/email.md#版式) |
| `languages` / `default_language` | 可选阅读语言（zh / orig）和订阅页默认值 | [邮件与 RSS](../features/email.md#中文版和原文版) |
| `links` | 外部文章抓取、摘要、超时、不抓取的域名 | [AI 精选](../features/curation.md#外部文章摘要) |
| `mail` | 合并发送、每封密送人数、发信间隔、标签页、`max_kb`、`max_parts` | [邮件与 RSS](../features/email.md) |
| `subscribe_page` | 头像个数、已订阅邮箱能否直接改设置 | [订阅页与管理后台](../features/web-admin.md) |
| `rss` | 每个 Feed 保留几条 | [邮件与 RSS](../features/email.md#rss) |
| `curation` | 允许的类型、编辑终审、对照最近几天去重 | [AI 精选](../features/curation.md#4-编辑终审整批) |

## `.env`

从 `.env.example` 复制。不要把 `.env` 提交到仓库，也不要把里面的密钥贴到别处。

| 变量 | 作用 |
|---|---|
| `DATABASE_URL` / `DATABASE_AUTH_TOKEN` | 数据库：本机默认 `file:../../data/app.db`；上云时换成 Turso 地址 |
| `CONFIG_DIR` | 配置目录，默认仓库根目录下的 `config/` |
| `LLM_API` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 大模型，见下文 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 发信，默认 QQ 邮箱（`SMTP_PASS` 填授权码，不是 QQ 密码；`MAIL_FROM` 的地址要和 `SMTP_USER` 一致）。没配时邮件不会真的发出，确认链接打印在终端 |
| `SITE_URL` | 网站公开地址，邮件里的确认、管理、退订、RSS 链接都用它 |
| `ADMIN_PASSWORD` | 管理后台密码；不设置时 `/admin` 不开放 |
| `ADMIN_EMAIL` | 管理员提醒发到这里；"今日反馈"也按它找你收到的那一期 |
| `WG_TUNNEL` | WireGuard 隧道名，连不上 X 时自动连接；不设置时用第一个 WireGuard 隧道 |
| `XRSS_CHROME_PATH` / `XRSS_CHROME_PROFILE` / `XRSS_CHROME_PORT` | 采集专用 Chrome 的路径、资料目录（`~/.xrss-chrome`）、调试端口（9333），一般不用改 |
| `XRSS_DEADLINE_HOUR` | 到几点仍连不上 X 就放弃今天的采集（默认 10） |
| `XRSS_ALLOW_PARTIAL` | 设为 1 时清单没采完 `daily.sh` 也照常处理（`daily-auto.sh` 在额度用完暂停时这样用） |

**环境变量的优先级**：`.env` 里的 `LLM_API_KEY` 优先于系统环境变量；其他变量以系统环境变量为准（系统里已有的不会被 `.env` 覆盖）。
anthropic 格式不读取 `ANTHROPIC_AUTH_TOKEN`，只用这里的密钥。旧名 `DEEPSEEK_API_KEY` 仍然有效，但会被 `LLM_API_KEY` 覆盖。

## 大模型

AI 初审、编辑终审、翻译和文章摘要都通过 `packages/pipeline/src/ai.ts` 调用同一个模型。采集不用大模型（Agent 版用的模型在 Agent 里配置，与这里无关）。

默认是 [DeepSeek 的 Anthropic 兼容接口](https://api-docs.deepseek.com/guides/anthropic_api)（`deepseek-flash`），支持两种接口格式：

| 变量 | 说明 |
|---|---|
| `LLM_API` | `anthropic`（Anthropic Messages API，默认）或 `openai`（OpenAI Chat Completions） |
| `LLM_BASE_URL` | 端点地址。anthropic 格式不用带 `/v1/messages`；openai 格式写到 `/v1` 这一级，不用带 `/chat/completions`（多写了会自动去掉，只写域名会补 `/v1`） |
| `LLM_MODEL` | 模型名，如 `deepseek-flash`、`gpt-5-mini`、`qwen-plus` |
| `LLM_API_KEY` | 对应服务的密钥 |

常见端点（以各家文档为准）：

| 格式 | 服务 | `LLM_BASE_URL` |
|---|---|---|
| anthropic | DeepSeek | `https://api.deepseek.com/anthropic` |
| anthropic | Anthropic | `https://api.anthropic.com` |
| anthropic | Kimi | `https://api.moonshot.cn/anthropic` |
| openai | OpenAI | `https://api.openai.com/v1` |
| openai | DeepSeek | `https://api.deepseek.com/v1` |
| openai | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| openai | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| openai | 本地 Ollama | `http://localhost:11434/v1` |

对模型的要求：

- **支持工具调用**（function calling / tool use）：初审、终审和文章摘要都通过强制调用一个工具返回结构化结果。个别服务不走工具、把 JSON 直接写在正文里时也能解析。
- **不需要图片输入**：图片和视频都不送给模型识别。
- **openai 格式的参数差异会自动适配**：新模型不接受 `max_tokens` 时改用 `max_completion_tokens`，推理模型不接受 `temperature` 时不传，不支持指定工具名时改为 `tool_choice: "required"`；同一次运行里只调整一次。
- **anthropic 格式会显式关闭思考模式**（`thinking: disabled`），因为 DeepSeek 的思考模式不接受强制工具调用。

每次运行的日志会打印实际使用的接口格式、模型和端点（不含密钥）。
