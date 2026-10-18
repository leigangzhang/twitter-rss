# 精选晨报（twitter-rss）

按主题跟踪 X 博主，每天自动采集、AI 过滤和翻译，精选 8–10 条推文发到订阅者邮箱，同时提供 RSS。
推文在邮件里完整呈现（长文全文、Thread 合并、引用、图片、链接预览），不用跳转 X 也能读完。

## 工作流程

```
本机 Mac（每天定时）                                     网站（订阅页 / RSS）
┌──────────────────────────────────────────────┐        ┌──────────────────────┐
│ pnpm plan        生成采集清单 plan.json       │        │ 订阅、确认、管理偏好   │
│      ↓                                        │        │ 退订、/feed/<主题>.xml │
│ Browser Skill    在 Chrome 中按清单采集       │        └──────────┬───────────┘
│      ↓           → data/inbox/<日期>/*.json   │                   │
│ pnpm pipeline    入库 → 规则粗筛 → AI 评审     │◀──── 共用数据库 ───┘
│                  → 按订阅者选稿 → 发送邮件     │   （本地 SQLite / 线上 Turso）
└──────────────────────────────────────────────┘
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
| `scripts/daily.sh` | 每日任务脚本；`scripts/launchd/` 是 macOS 定时任务模板 |

## 快速开始

需要 Node.js 22+ 和 pnpm。

```bash
pnpm install
cp .env.example .env          # 填写 API Key 等（可以先留空试跑）
pnpm db:migrate               # 建表
pnpm email:preview            # 用示例数据渲染邮件 → data/out/preview-zh.html / preview-orig.html
pnpm dev                      # 订阅页面 http://localhost:3000
```

本地没配 Resend 时，确认邮件不会真的发出，确认链接会打印在终端里，直接打开即可。

### 配置要跟踪的博主

编辑 `config/topics.yaml`，把占位账号换成真实账号（不带 @）。同一账号可以放进多个主题，由 AI 判断每条推文归到哪个主题。

### 试跑一遍流水线

```bash
pnpm plan                                   # 生成 data/inbox/<今天>/plan.json
# ……用 Browser Skill 采集，或者用测试样本模拟一个账号：
pnpm --filter @xrss/collector parse --handle MiraChen_ML packages/collector/test/fixtures/user-tweets.json
pnpm pipeline:dry --skip-ai                 # 不调用 AI、不发邮件，邮件写到 data/out/<日期>/
```

去掉 `--skip-ai` 会调用 Claude 打分、翻译和生成视频说明；去掉 `:dry` 才会真正发送。
（用测试样本模拟时，`topics.yaml` 里需要有 `MiraChen_ML` 这个账号。）

## 采集（Browser Skill）

采集端与流水线之间只约定一件事：**每个账号输出一个 `data/inbox/<日期>/<handle>.json`，格式见 `schemas/inbox-file.schema.json`**。采集方式以后怎么换，下游都不用改。

- 交给 Agent 的任务说明：`packages/collector/AGENT_PROMPT.md`
- 能拿到网络响应时，把 X 网页 `UserTweets` 接口的 JSON 存下来，用 `pnpm --filter @xrss/collector parse` 转换，比解析页面元素稳定
- 采集端遇到限流、登录失效、验证码时写入对应 `status` 并停止，流水线会告警，退出码为 2

降低封号风险：使用专用小号；`plan.json` 已随机打乱账号顺序并给出停留和滚动间隔；`daily.sh` 启动时随机延迟 0–30 分钟；只抓增量（`lastSeenId`）。

> 用浏览器自动化抓取 X 不符合 X 的服务条款，请自行评估风险，仅用于个人或小范围场景。

## 每日定时（macOS）

```bash
# .env 中设置 COLLECT_CMD，指向调用 Browser Skill 的 Agent 命令
sed "s|__ROOT__|$PWD|g" scripts/launchd/com.xrss.daily.plist > ~/Library/LaunchAgents/com.xrss.daily.plist
launchctl load ~/Library/LaunchAgents/com.xrss.daily.plist
```

日志在 `data/logs/`。

## 选稿规则

- **规则粗筛**：排除回复、纯转发、过短内容；规则分 = 互动表现相对作者自己近 30 天中位数（避免大号天然占优）
- **AI 评审**：每个主题取规则分前 N 条（`candidates_per_topic`）送 Claude，返回质量分、所属主题、中文翻译、视频/图片说明
- **最终分** = (0.7 × 质量分 + 0.3 × 规则分) × 媒体权重（视频默认 0.6）
- **选稿**：每个订阅主题保底 `min_per_topic` 条，其余按分数补足到 `total_items`；按主题分区，当天没内容的主题不显示

## 上线

- 数据库：把 `DATABASE_URL` 换成 Turso 地址，本机流水线和线上网站共用
- 网站：`apps/web` 可部署到 Vercel 等平台；设置 `SITE_URL`、`RESEND_API_KEY`、`MAIL_FROM`，并把 `config/` 目录一起部署（或设置 `CONFIG_DIR`）
- 邮件：在 Resend 验证发信域名；邮件已带 `List-Unsubscribe` 一键退订头

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有单元测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm schema` | 修改采集数据格式后重新生成 JSON Schema |
| `pnpm --filter @xrss/core db:generate` | 修改表结构后生成迁移文件 |
