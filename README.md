# 精选晨报（twitter-rss）

按主题跟踪 X（原 Twitter）博主，每天自动采集、AI 过滤和翻译，把通过精选的推文按主题整理成一封邮件发给订阅者，同时提供 RSS。
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

编辑 `config/topics.yaml`（不带 @）。同一账号可以放进多个主题，由 AI 判断每条推文归到哪个主题。

目前是 5 个主题、100 个账号（由司徒K榜单原来的 10 组合并而来）：实验室与官方发布、研究者与深度观点、AI 编程/Agent 与开源、中文圈｜行业解读与产品出海、中文圈｜开发实践与内容创作。

- `description`：订阅页主题卡片上的一句话说明。
- `aliases`：并入本主题的旧主题 id。合并或改名主题时把旧 id 写进来：老订阅者的选择、数据库里旧推文的主题、旧的 RSS 地址（301 跳转）都会自动映射到新主题，不用改数据库。

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

- **预算**：每次最多打开的页面数、详情页补抓数、每个主页的滚动次数都有上限（默认每次最多 40 个账号），补抓按互动量排优先级。
- **轮转不丢内容**：账号多于预算时按"超期最多"轮转。每个账号记录已入库内容覆盖到的时间点，下次采集时从那里补收（最多往回 `catch_up_days` 天，默认 4 天），补收的内容和当天内容一起评审、进入当天邮件。
- **优 / 劣质账号**：按最近 14 天（`stats_days`，建议 7–14 天）AI 评审的保留率给账号分档：优质（≥ 35%）每次都采、普通约隔天、低质（< 12%）和 14 天没发推的不活跃账号约 3 天一次；评审过的推文不足 6 条时按普通处理。
  样本足够（≥ 20 条）且保留率 < 5% 的账号会在报告里建议从 `topics.yaml` 移出（不会自动删除）。`pnpm accounts` 查看分档，每天的精选报告末尾也有。阈值和间隔在 `config/crawl.yaml` 的 `account_quality` 中调整。
- **节奏**：`pnpm plan` 用随机数预先排好开始前的等待、每个主页之间的停留、每次滚动的停顿和中途长休息，采集端照做即可；账号顺序每天打乱，同一账号的详情页不连续打开。
- **频率**：只在允许的时段（默认 6–23 点）开始采集；同一账号两次采集至少间隔 20 小时；只看前一天的内容。
- **熔断**：采集端遇到限流、验证码、登录失效立即停止并写入状态；`parse` 据此进入冷却期（限流 24 小时、验证码 48 小时，连续出现时加倍，最长 7 天），登录失效改为人工暂停。冷却期内 `pnpm plan` 以退出码 3 结束，定时任务不会打开浏览器。
- **逐步采集**：采集端（DeepSeek Harness 里的 AI + Browser Skill）不再一次性执行整个流程，而是循环运行 `pnpm crawl next` 领取下一步（脚本负责等待和顺序），做完后 `pnpm crawl done <key>` 报告；`done` 会检查网络响应是否真的保存。清单没采完时 `scripts/daily.sh` 不发送（退出码 4），`pnpm crawl progress` 查看进度，中断后再运行会从断点继续。
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
  - 读者定位：有一定技术背景的产品、研发和 AI 爱好者（大多不是大模型研究者）；对他们有用或有启发就保留，拿不准时有具体信息的保留
  - 类型：最佳实践与用法 / 真实世界问题 / 新发布与新能力 / 应用案例与灵感 / 行业趋势与解读 / 专家思考，都不是则为"其他"
  - 去留：说教、显而易见、没有思考、纯搬运、重复、推广、闲聊剔除；类型不在 `allowed_categories` 或质量分低于 `min_quality`（默认 3）也剔除
  - 质量分为 **5 分制**：5 必读、4 值得读、3 有收获（保留最低分）、2 价值低、1 不推荐。旧数据的 10 分制分数读取时自动折半
  - 同时输出一句话摘要、判断理由、中文翻译、视频/图片说明
- **编辑终审**（整批）：把当天通过初审的推文放在一起，去掉同一事件、相同观点，以及最近 `recent_days` 天邮件里发过的内容
- **重新评审**：改了 `curation.md` 后，运行 `pnpm pipeline:dry --rereview` 让时间范围内已评审的推文按新标准重评，对比精选报告
- **精选报告**：每次运行写出 `data/out/<日期>/curation.md`，列出分数分布，以及每条的类型、分数、理由和剔除原因，用来检查判断、调整 `curation.md`
- **最终分** = (0.7 × 质量分/5 + 0.3 × 规则分) × 媒体权重（视频默认 0.6）
- **选稿**：每个订阅主题保底 `min_per_topic` 条，其余按分数补足到 `total_items`；按主题分区，当天没内容的主题不显示

## 上线

- 数据库：把 `DATABASE_URL` 换成 Turso 地址，本机流水线和线上网站共用
- 网站：`apps/web` 可部署到 Vercel 等平台；设置 `SITE_URL`、`SMTP_*`、`MAIL_FROM`，并把 `config/` 目录一起部署（或设置 `CONFIG_DIR`）
- 邮件：QQ 邮箱 SMTP（`smtp.qq.com:465`），逐封发送并间隔 1.5 秒；QQ 邮箱对每日发信量有限制，订阅者多了以后建议换企业邮箱或专业发信服务

## 外部文章的图文摘要

推文本身或它引用的推文里带有外部文章链接时（例如官方技术博客），邮件会在推文下方（或引用框内）显示一张文章卡片：
封面图、来源、中文标题和原标题、2–3 句概要、3–5 条要点，以及"阅读原文"链接，不打开原文也能知道讲了什么。

- **抓取**：评审前用普通 HTTP 请求抓取文章（不经过 X），取 Open Graph 标题、简介、封面和正文；结果按链接缓存在数据库，同一篇只抓一次，失败的 6 小时后重试。
- **参与精选**：文章标题和正文开头会一起交给初审，"转发链接 + 一句话"的推文按文章本身的价值判断。
- **摘要**：通过精选后，用 DeepSeek 生成中文标题、概要和要点（只根据抓到的内容，不编造）。
- **兜底**：抓不到正文（站点拒绝、需要登录、超时）时，用 X 卡片里的标题和封面显示；X 长文（x.com/i/article）仍显示为链接卡片。
- 配置在 `config/digest.yaml` 的 `links`：可关闭抓取或摘要，调整超时，设置不抓取的域名。

## 订阅页

- 每个主题卡片显示博主头像（从左到右叠放）和 ID，超过 `subscribe_page.max_avatars`（默认 7）个只显示 +N。头像和显示名来自采集时记录的账号资料，还没采集过的账号显示首字母。
- **已订阅的邮箱直接在订阅页改设置**：用同一个邮箱重新选择主题和语言后提交，立即覆盖原设置，不需要确认邮件或管理链接。同时给该邮箱发一封"订阅设置已更新"通知（含修改前后的设置和改回去的链接，10 分钟内最多一封），防止被他人代改而不知情。
- 新邮箱、已退订或未确认的邮箱仍需点确认邮件，避免给别人订阅。
- 不想允许直接覆盖时，把 `config/digest.yaml` 的 `subscribe_page.overwrite_existing` 设为 `false`。

- **邮件预览**：订阅页右侧展示一份固定的真实示例（`apps/web/data/preview.json`），由 `pnpm preview:snapshot` 从最近 7 天通过精选的推文里按评分从高到低取 `total_items` 条生成，之后不随每天的数据变化；想换一批时再运行一次（可加 `--days 14 --count 8`）。

## 订阅者管理

- **网页**：在 `.env` 设置 `ADMIN_PASSWORD` 后打开 `/admin/subscribers`，输入密码登录（8 小时有效）。列出每位订阅者的邮箱、状态（正常 / 待确认 / 已退订）、语言、主题、订阅和确认时间、最近发送日期和累计封数，标出"主题全部失效""超过 3 天未确认"等问题；可按状态筛选、导出 CSV。没设置密码时这个页面不开放（404），也不会被搜索引擎收录。
- **命令行**：`pnpm subscribers` 列出同样的信息，加 `--csv` 导出到 `data/out/subscribers.csv`。

## 推送历史与重新推送

- **网页** `/admin/deliveries`（与订阅者页同一个密码）：按天列出每一期的成功、失败、未收到人数和推文数。点开某一期可以看到：
  - 收件人：每人的结果、发送时间、收到几条、发送了几次，"查看邮件"打开这封邮件的内容；
  - 发出的推文：每条被多少人收到；
  - 发送记录：每一次定时发送、补发、重新发送、重试的时间和结果（合并发送会注明几人一封）。
- **重新推送**（点按钮后需要再确认一次）：
  - 重新发送：给某一位重发这一期，按这一期**最新的内容**（含之后补采、重新评审的）和他现在的主题、语言重新挑选，生成一封带个人链接的邮件；"已发出的"可以查看当时发出的那封，"预览重发"查看将要发出的；
  - 重试失败的：这一期所有发送失败的人逐个重发；
  - 补发给未收到的：这一期结束前已确认、却没有任何发送记录的人（不会给之后才订阅的人补发旧内容）。
- **命令行**：`pnpm resend` 列出推送历史；`pnpm resend --date 2026-10-19` 查看某一期；加 `--failed` 重试失败的、`--missing` 补发、`--to 邮箱` 重新发给某人。
- 每次发送都记在 `delivery_attempts` 表里（只增不改）；`deliveries` 保留每人每期的最终结果，重发失败不会覆盖之前已经成功的记录。

## 邮件版式

- **主题标签页**（`mail.tabs`）：苹果邮件（Mac / iPhone）、163 网页版等可以点主题标签切换；QQ 邮箱、Gmail 网页版等不支持，自动按主题依次排列，顶部是可跳转的主题目录。
- **条数和大小**：通过精选的推文都会放进邮件（最多 `digest.total_items`，默认 30 条，按分数排序）。超过 `mail.max_kb`（默认 95KB，Gmail 超过约 102KB 会折叠末尾）时，从条目最多的主题末尾开始改为"还有 N 条"一句话摘要，每个主题至少保留一张完整卡片。
- **内容呈现**：推文正文完整显示；引用较长或被截断时显示 AI 摘要和要点；多图一张一行、点开是大图；外部文章以小字标题 + AI 概要呈现。
- `pnpm email:test --to 邮箱1,邮箱2` 用某一期的真实内容发测试邮件，顶部会显示该邮箱是否支持标签页。

## 发信与合并发送

主题组合和阅读语言完全相同的订阅者，收到的内容完全一样。默认把他们合并成一封邮件：只渲染一次，
收件人放在密送（BCC）里，每封最多 `bcc_batch_size` 人（默认 20），超过分成多封。例如 100 个订阅者只有 6 种"主题 + 语言"组合时，
每天只需发 6–10 封邮件，而不是 100 封。

- 合并邮件不能放每个人专属的链接，页脚的"管理订阅 / 切换语言 / 退订"指向通用页面 `/manage`：输入邮箱后，系统把专属链接发到这个邮箱（同一邮箱 5 分钟内只发一次，且不透露邮箱是否订阅过）。
- 某个组合只有一个人时仍单独发送，带专属链接和一键退订（`List-Unsubscribe-Post`）。
- 发送记录按人保存，同一天重复运行不会重发；某封失败只影响这一批收件人，下次运行会补发。
- 在 `config/digest.yaml` 的 `mail` 中调整：`group_identical: false` 关闭合并，`bcc_batch_size` 调整每封人数。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有单元测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm schema` | 修改采集数据格式后重新生成 JSON Schema |
| `pnpm --filter @xrss/core db:generate` | 修改表结构后生成迁移文件 |
