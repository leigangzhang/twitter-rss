# 精选晨报（twitter-rss）

按主题跟踪 X 博主，每天自动采集、AI 过滤和翻译，精选 8–10 条推文发到订阅者邮箱，同时提供 RSS。
推文在邮件里完整呈现（长文全文、Thread 合并、引用、图片、链接预览），不用跳转 X 也能读完。

## 工作流程

```
本机 Mac · DeepSeek Harness 定时任务（每天 06:30）           网站（订阅页 / RSS）
┌────────────────────────────────────────────────┐        ┌──────────────────────┐
│ pnpm plan          生成采集清单 plan.json        │        │ 订阅、确认、管理偏好   │
│      ↓                                          │        │ 退订、/feed/<主题>.xml │
│ Browser Skill      在 Chrome 中按清单采集        │        └──────────┬───────────┘
│      ↓             → data/inbox/<日期>/*.json    │                   │
│ scripts/daily.sh   入库 → 规则粗筛               │◀──── 共用数据库 ───┘
│                    → DeepSeek 初审（价值类型）    │   （本地 SQLite / 线上 Turso）
│                    → DeepSeek 终审（去重）        │
│                    → 按订阅者选稿 → QQ 邮箱发信    │
└────────────────────────────────────────────────┘
```

## 目录

| 位置 | 内容 |
|---|---|
| `config/topics.yaml` | 主题 ↔ 博主映射，**只采集这里列出的账号** |
| `config/digest.yaml` | 精选条数、过滤阈值、视频降权、语言等规则 |
| `packages/core` | 数据格式（采集契约）、配置校验、数据库表、打分与选稿算法 |
| `packages/collector` | 采集清单、Browser Skill 的任务说明、X 网页接口响应解析 |
| `packages/pipeline` | 每日流水线：入库、AI 评审、发送邮件 |
| `packages/emails` | 邮件模板（React Email），与设计稿一致 |
| `apps/web` | Next.js 订阅页面、偏好管理、退订、RSS |
| `schemas/inbox-file.schema.json` | 采集输出的 JSON Schema（由 `pnpm schema` 生成） |
| `config/crawl.yaml` | 采集节流策略：预算、节奏、活跃时段、异常后的冷却 |
| `config/curation.md` | **精选标准**：要什么、不要什么，原样放进给大模型的提示词，可直接修改 |
| `deepseek-harness/daily-task.md` | DeepSeek Harness 每日定时任务的提示词和安装步骤 |
| `scripts/daily.sh` | 采集完成后的处理：解析 → 入库 → AI 精选 → 发信，写日志 |

## 快速开始

需要 Node.js 22+ 和 pnpm。

```bash
pnpm install
cp .env.example .env          # 填写 API Key 等（可以先留空试跑）
pnpm db:migrate               # 建表
pnpm email:preview            # 用示例数据渲染邮件 → data/out/preview-zh.html / preview-orig.html
pnpm dev                      # 订阅页面 http://localhost:3000
```

本地没配 SMTP 时，确认邮件不会真的发出，确认链接会打印在终端里，直接打开即可。

### 配置要跟踪的博主

编辑 `config/topics.yaml`，把占位账号换成真实账号（不带 @）。同一账号可以放进多个主题，由 AI 判断每条推文归到哪个主题。

### 试跑一遍流水线

默认只处理**前一天**（北京时间 0:00–24:00）发布的推文：10 月 19 日早上运行，处理 10 月 18 日的内容（`config/digest.yaml` 的 `collect_window`）。

```bash
pnpm plan                                   # 生成 data/inbox/<今天>/plan.json（含 since/until）
# ……用 Browser Skill 按 AGENT_PROMPT.md 采集时间线 → parse → 补抓详情页 → 再 parse
pnpm pipeline:dry --skip-ai                 # 不调用 AI、不发邮件，邮件写到 data/out/<日期>/
```

补跑某一天：`pnpm pipeline:dry --skip-ai --date 2026-10-19`（处理 10 月 18 日的内容，读取 `data/inbox/2026-10-19/`）。

### 验证 AI 精选和 QQ 邮箱发信

1. 在 `.env` 填好 `DEEPSEEK_API_KEY`，运行 `pnpm pipeline:dry`（不带 `--skip-ai`）。
   终端会显示初审通过/剔除、终审去重的条数；打开 `data/out/<日期>/curation.md` 看每条的类型、分数和理由，
   打开 `data/out/<日期>/sample-zh.html` 看邮件效果。
   已评审过的推文不会重复评审；改了 `config/curation.md` 想重新评审，删掉 `data/app.db` 后重新运行。
2. 在 QQ 邮箱网页版 → 设置 → 账号与安全，开启 SMTP 服务并生成**授权码**；
   `.env` 填好 `SMTP_USER`（QQ 邮箱地址）、`SMTP_PASS`（授权码）和 `MAIL_FROM`。
   `pnpm dev` 打开订阅页，用自己的邮箱订阅并点确认链接，然后运行 `scripts/daily.sh`（不带 `--dry-run`）。
   同一订阅者同一天只发一封，重复运行会显示"今日已发过"。

## 采集（Browser Skill）

采集端与流水线之间只约定一件事：**每个账号输出一个 `data/inbox/<日期>/<handle>.json`，格式见 `schemas/inbox-file.schema.json`**。采集方式以后怎么换，下游都不用改。

- 交给 Agent 的任务说明：`packages/collector/AGENT_PROMPT.md`
- 能拿到网络响应时，把 X 网页 `UserOriginalsTimeline` / `UserTweets` 接口的 JSON 存下来，用 `pnpm --filter @xrss/collector parse` 转换，比解析页面元素稳定
- **时间线接口不含长推文全文和 X 长文标题**：`parse` 会按 X 的字数规则找出可能被截断的推文，写入 `detail-needed.json`；采集端再打开这些推文的详情页，保存 `TweetDetail` 响应后重新 `parse`，全文会自动合并。没补抓到的推文在邮件里会提示"全文较长"
- 采集端遇到限流、登录失效、验证码时写入对应 `status` 并停止，流水线会告警，退出码为 2

### 节流与熔断（`config/crawl.yaml`）

目标是让采集强度接近正常人浏览、尽量不触发 X 的限流，出现问题立即停下，而不是绕过检测。

- **预算**：每次最多打开的页面数、详情页补抓数、每个主页的滚动次数都有上限；账号多于预算时按"最久没采集"轮转，补抓按互动量排优先级。
- **节奏**：`pnpm plan` 用随机数预先排好开始前的等待、每个主页之间的停留、每次滚动的停顿和中途长休息，采集端照做即可；账号顺序每天打乱，同一账号的详情页不连续打开。
- **频率**：只在允许的时段（默认 6–23 点）开始采集；同一账号两次采集至少间隔 20 小时；只看前一天的内容。
- **熔断**：采集端遇到限流、验证码、登录失效立即停止并写入状态；`parse` 据此进入冷却期（限流 24 小时、验证码 48 小时，连续出现时加倍，最长 7 天），登录失效改为人工暂停。冷却期内 `pnpm plan` 以退出码 3 结束，定时任务不会打开浏览器。
- **状态**：`pnpm crawl:status` 查看冷却期、最近异常和用量；重新登录后运行 `pnpm crawl:reset` 解除暂停。状态保存在 `data/crawl-state.json`。
- **不做的事**：不伪装浏览器指纹、不换 IP 或代理、不轮换多个账号、不自动处理验证码。建议使用专用小号。

> 用浏览器自动化抓取 X 不符合 X 的服务条款，请自行评估风险，仅用于个人或小范围场景。

## 大模型（DeepSeek）

| 用途 | 在哪里运行 | 模型配置 |
|---|---|---|
| 采集 X（Browser Skill） | DeepSeek Harness 定时任务（desktop / web profile） | 在 Harness 的 profile 里选 `deepseek-flash` |
| AI 初审、编辑终审、翻译、视频/图片说明 | `scripts/daily.sh` → `packages/pipeline/src/ai.ts` | `.env` 的 `DEEPSEEK_API_KEY`、`LLM_MODEL=deepseek-flash` |

AI 精选通过 [DeepSeek 的 Anthropic 兼容接口](https://api-docs.deepseek.com/guides/anthropic_api) 调用。换模型改 `.env` 的 `LLM_MODEL`（如 `deepseek-v4-pro`）；换成其他兼容 Anthropic 接口的服务，再设置 `LLM_BASE_URL`。

## 每日定时（DeepSeek Harness）

定时任务装在 DeepSeek Harness 里：按 [`deepseek-harness/daily-task.md`](deepseek-harness/daily-task.md) 安装 Browser Skill、在 profile 中启用它，
新建每天 06:30 的定时任务并粘贴其中的提示词。任务依次执行 `pnpm plan` → Browser Skill 采集 → `scripts/daily.sh` → 汇报。

日志在 `data/logs/`，精选报告在 `data/out/<日期>/curation.md`。

## 选稿规则

- **规则粗筛**：排除回复、纯转发、过短内容；规则分 = 互动表现相对作者自己近 30 天中位数（避免大号天然占优）
- **AI 初审**（逐条）：每个主题取规则分前 N 条（`candidates_per_topic`）送 DeepSeek，按 `config/curation.md` 判断
  - 类型：最佳实践与应用 / 真实世界问题 / 行业趋势与解读 / 行业领袖与专家思考，都不是则为"其他"
  - 去留：说教、显而易见、没有思考、纯搬运、重复、推广、闲聊一律剔除；类型不在 `allowed_categories` 或质量分低于 `min_quality` 也剔除
  - 同时输出质量分、一句话摘要、判断理由、中文翻译、视频/图片说明
- **编辑终审**（整批）：把当天通过初审的推文放在一起，去掉同一事件、相同观点，以及最近 `recent_days` 天邮件里发过的内容
- **精选报告**：每次运行写出 `data/out/<日期>/curation.md`，列出每条的类型、分数、理由和剔除原因，用来检查判断、调整 `curation.md`
- **最终分** = (0.7 × 质量分 + 0.3 × 规则分) × 媒体权重（视频默认 0.6）
- **选稿**：每个订阅主题保底 `min_per_topic` 条，其余按分数补足到 `total_items`；按主题分区，当天没内容的主题不显示

## 上线

- 数据库：把 `DATABASE_URL` 换成 Turso 地址，本机流水线和线上网站共用
- 网站：`apps/web` 可部署到 Vercel 等平台；设置 `SITE_URL`、`SMTP_*`、`MAIL_FROM`，并把 `config/` 目录一起部署（或设置 `CONFIG_DIR`）
- 邮件：QQ 邮箱 SMTP（`smtp.qq.com:465`），逐封发送并间隔 1.5 秒；QQ 邮箱对每日发信量有限制，订阅者多了以后建议换企业邮箱或专业发信服务。邮件已带 `List-Unsubscribe` 一键退订头

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有单元测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm schema` | 修改采集数据格式后重新生成 JSON Schema |
| `pnpm --filter @xrss/core db:generate` | 修改表结构后生成迁移文件 |
