# 详细说明

首页 [README](../README.md) 讲怎么用起来，这里是各部分的细节和全部配置项。

## 项目结构

| 位置 | 内容 |
|---|---|
| `config/topics.yaml` | 主题 ↔ 博主映射，**只采集这里列出的账号** |
| `config/digest.yaml` | 精选条数、过滤阈值、视频降权、语言等规则 |
| `packages/core` | 数据格式（采集契约）、配置校验、数据库表、打分与选稿算法 |
| `packages/collector` | 采集清单、逐步采集（`crawl next / done`）、脚本采集（`crawl:auto`，`src/browser/`）、给 Agent 的采集说明、X 网页数据解析 |
| `packages/pipeline` | 每日流水线：入库、AI 评审、发送邮件 |
| `packages/emails` | 邮件模板（React Email），与设计稿一致 |
| `apps/web` | Next.js 订阅页面、偏好管理、退订、RSS |
| `schemas/inbox-file.schema.json` | 采集输出的 JSON Schema（由 `pnpm schema` 生成） |
| `config/crawl.yaml` | 采集节流策略：预算、节奏、活跃时段、异常后的冷却 |
| `config/curation.md` | **精选标准**：要什么、不要什么，原样放进给大模型的提示词，可直接修改 |
| `agents/` | 脚本版每日任务说明和 launchd 配置（`script-mode.md`、`com.xrss.auto.plist`），Agent 版的提示词和接入方式 |
| `scripts/daily-auto.sh` | 脚本版每日任务：网络自检 → 采集清单 → `crawl:auto` 采集 → `daily.sh`，异常时提醒管理员 |
| `scripts/daily.sh` | 采集完成后的处理：解析 → 入库 → AI 精选 → 发信，写日志 |

## 采集

采集端与流水线之间只约定一件事：**每个账号输出一个 `data/inbox/<日期>/<handle>.json`，格式见 `schemas/inbox-file.schema.json`**。采集方式以后怎么换，下游都不用改。

- **脚本采集（默认）**：`pnpm crawl:auto` 连接采集专用的 Chrome（`pnpm crawl:chrome` 打开，独立资料 `~/.xrss-chrome`，调试端口 9333），按清单打开主页、滚动，把 X 网页自己发出的 `UserOriginalsTimeline` / `UserTweets` / `UserByScreenName` / `TweetDetail` 响应原样存到 `raw/`，再用 `parse` 转换。`--trial N`（可加 `--accounts a,b`）试采，结果放在 `data/trial/`，不影响正式进度和冷却。说明见 [agents/script-mode.md](../agents/script-mode.md)
- **Agent 采集（备用）**：采集说明在 `packages/collector/AGENT_PROMPT.md`，每日任务的提示词和各 Agent 的接入方式见 [`agents/`](../agents/README.md)。Browser Skill 抓网络数据有 256 KiB 上限，X 的时间线数据通常更大，这时 Agent 会从页面读取推文（`crawl done --no-response`），入库时自动修复页面读取带来的断行
- **长推文全文**：时间线响应里带 `note_tweet` 时就是全文（同一个响应里有推文带 `note_tweet`，没带的就是完整的短推文，不算截断）；不带时 `parse` 按 X 的字数规则找出可能被截断的推文，写入 `detail-needed.json`，采集端再打开这些推文的详情页，保存 `TweetDetail` 响应后重新 `parse`，全文自动合并。没补抓到的推文在邮件里会提示"全文较长"
- 采集端遇到限流、登录失效、验证码时写入对应 `status` 并停止，流水线照常处理已采到的内容并告警，退出码为 2

### 节流与熔断（`config/crawl.yaml`）

目标是让采集强度接近正常人浏览、尽量不触发 X 的限流，出现问题立即停下，而不是绕过检测。

- **预算**：每次最多打开的页面数、详情页补抓数、每个主页的滚动次数都有上限（每次最多 50 个账号，见 `crawl.yaml` 的 `max_accounts_per_run`），补抓按互动量排优先级。
- **轮转不丢内容**：账号多于预算时按"超期最多"轮转。每个账号记录已入库内容覆盖到的时间点，下次采集时从那里补收（最多往回 `catch_up_days` 天，默认 4 天），补收的内容和当天内容一起评审、进入当天邮件。
- **优 / 劣质账号**：按最近 14 天（`stats_days`，建议 7–14 天）AI 评审的保留率给账号分档：优质（≥ 35%）每次都采、普通约隔天、低质（< 12%）和 14 天没发推的不活跃账号约 3 天一次；评审过的推文不足 6 条时按普通处理。
  样本足够（≥ 20 条）且保留率 < 5% 的账号会在报告里建议从 `topics.yaml` 移出（不会自动删除）。`pnpm accounts` 查看分档，每天的精选报告末尾也有。阈值和间隔在 `config/crawl.yaml` 的 `account_quality` 中调整。
- **节奏**：`pnpm plan` 用随机数预先排好开始前的等待、每个主页之间的停留、每次滚动的停顿和中途长休息，采集端照做即可；账号顺序每天打乱，同一账号的详情页不连续打开。
- **频率**：只在允许的时段（默认 6–23 点）开始采集；同一账号两次采集至少间隔 20 小时；只看前一天的内容。
- **额度**：X 在每个响应头里给出接口额度（`x-rate-limit-limit / -remaining / -reset`，按 15 分钟窗口）。`crawl:auto` 在每一步前估算要用的请求数，额度不够且 20 分钟内重置时等到重置再继续；要等更久时暂停采集（退出码 6，不算异常、不冷却）；时间线额度只剩 1 次时不再滚动。每一步的接口、状态码和额度记在 `data/inbox/<日期>/calls.jsonl`，最近的额度存在 `ratelimit.json`，同一天重新运行时接着用。
- **熔断**：只有采集用到的接口（`UserByScreenName`、`UserTweets`、`UserOriginalsTimeline`、`TweetDetail`）返回 429、或页面提示限流，才算限流；主页上推荐关注、侧边栏等附带请求的 429 只记录，不停止。遇到限流、验证码、登录失效立即停止并写入状态，进入冷却期（限流 24 小时、验证码 48 小时，连续出现时加倍，最长 7 天），登录失效改为人工暂停。冷却期内 `pnpm plan` 以退出码 3 结束，定时任务不会打开浏览器。
- **单个账号出错**：账号不存在、已改名或被冻结时跳过（不停止、不冷却），并提醒改 `topics.yaml`；页面没加载出来等其他错误先放到最后几分钟后重试一次，同一账号再失败或连续两个账号失败才停止（冷却 6 小时）。
- **逐步采集**：采集端（任意 Agent + 浏览器工具）不再一次性执行整个流程，而是循环运行 `pnpm crawl next` 领取下一步（脚本负责等待和顺序），做完后 `pnpm crawl done <key>` 报告；`done` 会检查网络响应是否真的保存。清单没采完时 `scripts/daily.sh` 不发送（退出码 4；设置 `XRSS_ALLOW_PARTIAL=1` 时照常处理已采到的内容，`daily-auto.sh` 在额度用完暂停时这样用），`pnpm crawl progress` 查看进度，中断后再运行会从断点继续。
- **状态**：`pnpm crawl:status` 查看冷却期、最近异常和用量；重新登录后运行 `pnpm crawl:reset` 解除暂停；确认异常已排除（比如断网被误记成异常）后，`pnpm crawl:resume` 解除冷却、从出错的那一步接着采。状态保存在 `data/crawl-state.json`。
- **不做的事**：不伪装浏览器指纹、不换 IP 或代理、不轮换多个账号、不自动处理验证码。建议使用专用账号；同一个账号的额度是所有操作共用的，手动浏览、关注等操作和采集至少隔开 60 分钟。

> 用浏览器自动化抓取 X 不符合 X 的服务条款，请自行评估风险，仅用于个人或小范围场景。

## 大模型

| 用途 | 在哪里运行 | 模型配置 |
|---|---|---|
| 采集 X（浏览器操作） | 脚本版 `pnpm crawl:auto` 不用大模型；备用的 Agent 版在你选的 Agent 里运行 | 在 Agent 里配置，与精选用的模型无关 |
| AI 初审、编辑终审、翻译、摘要 | `scripts/daily.sh` → `packages/pipeline/src/ai.ts` | `.env` 的 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` |

AI 精选支持两种接口格式，默认是 [DeepSeek 的 Anthropic 兼容接口](https://api-docs.deepseek.com/guides/anthropic_api)。在 `.env` 里自定义：

| 变量 | 说明 |
|---|---|
| `LLM_API` | `anthropic`（Anthropic Messages API，默认）或 `openai`（OpenAI Chat Completions） |
| `LLM_BASE_URL` | 端点地址。anthropic 格式不用带 `/v1/messages`；openai 格式写到 `/v1` 这一级，不用带 `/chat/completions`（多写了会自动去掉，只写域名会补 `/v1`） |
| `LLM_MODEL` | 模型名，如 `deepseek-flash`、`gpt-5-mini`、`qwen-plus` |
| `LLM_API_KEY` | 对应服务的密钥，旧名 `DEEPSEEK_API_KEY` 仍然有效。`.env` 里的 `LLM_API_KEY` 优先于系统环境变量（其他变量以系统环境变量为准）；anthropic 格式不读取 `ANTHROPIC_AUTH_TOKEN`，只用这里的密钥 |

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
- **不需要图片输入**：图片和视频都不送给模型识别，邮件里视频只显示封面（`config/digest.yaml` 的 `video_mode`）。
- **openai 格式的参数差异会自动适配**：新模型不接受 `max_tokens` 时改用 `max_completion_tokens`，推理模型不接受 `temperature` 时不传，不支持指定工具名时改为 `tool_choice: "required"`；同一次运行里只调整一次。
- **anthropic 格式会显式关闭思考模式**（`thinking: disabled`），因为 DeepSeek 的思考模式不接受强制工具调用。

每次运行的日志会打印实际使用的接口格式、模型和端点（不含密钥）。

## 选稿规则

- **规则粗筛**：排除回复、纯转发、过短内容；规则分 = 互动表现相对作者自己近 30 天中位数（避免大号天然占优）
- **AI 初审**（逐条）：每个主题每天取规则分前 N 条（`candidates_per_topic`，默认 30）送大模型，按 `config/curation.md` 判断
  - N 是当天的总数：已送去评审的（通过、剔除、失败）都算在内，同一天重跑只补足到 N；评审失败的（密钥失效、超时、格式不符等）下次运行时重新评审，不重复占用名额。单条评审遇到格式不符等偶发错误时当场最多试三次
  - 读者定位：有一定技术背景的产品、研发和 AI 爱好者（大多不是大模型研究者）；对他们有用或有启发就保留，拿不准时有具体信息的保留
  - 类型：最佳实践与用法 / 真实世界问题 / 新发布与新能力 / 应用案例与灵感 / 行业趋势与解读 / 专家思考，都不是则为"其他"
  - 去留：说教、显而易见、没有思考、纯搬运、重复、推广、闲聊剔除；类型不在 `allowed_categories` 或质量分低于 `min_quality`（默认 3）也剔除
  - 质量分为 **5 分制**：5 必读、4 值得读、3 有收获（保留最低分）、2 价值低、1 不推荐。旧数据的 10 分制分数读取时自动折半
  - 同时输出一句话摘要（终审去重用）、判断理由、中文翻译（图片和视频不做识别）
  - 长推文和 Thread 另外输出阅读摘要：一句 40 字以内的结论（有大胆预测或反主流观点时就写它）+ 最多 3 条关键依据（每条只留 1–2 个关键数字），合计约 150 字以内；整体总结而非逐条复述，写出提到的工具和产品名称。邮件里正文超过 300 字时先显示它、原文折叠；旧数据没有阅读摘要时显示一句话摘要
- **编辑终审**（整批）：把当天通过初审的推文放在一起，去掉同一事件、相同观点，以及最近 `recent_days` 天邮件里发过的内容
- **重新评审**：改了 `curation.md` 后，运行 `pnpm pipeline:dry --rereview` 让时间范围内已评审的推文按新标准重评，对比精选报告
- **精选报告**：每次运行写出 `data/out/<日期>/curation.md`，列出分数分布，以及每条的类型、分数、理由和剔除原因，用来检查判断、调整 `curation.md`
- **最终分** = (0.7 × 质量分/5 + 0.3 × 规则分) × 媒体权重（视频默认 0.6）
- **选稿**：每个订阅主题保底 `min_per_topic` 条，其余按分数补足到 `total_items`；按主题分区，当天没内容的主题不显示

## 外部文章的图文摘要

推文本身或它引用的推文里带有外部文章链接时（例如官方技术博客），邮件会在推文下方（或引用框内）用小字标出文章来源和标题（可点开），下面是 2–3 句中文概要和 3–5 条要点，不打开原文也能知道讲了什么。

- **抓取**：评审前用普通 HTTP 请求抓取文章（不经过 X），取 Open Graph 标题、简介、封面和正文；结果按链接缓存在数据库，同一篇只抓一次，失败的 6 小时后重试。
- **参与精选**：文章标题和正文开头会一起交给初审，"转发链接 + 一句话"的推文按文章本身的价值判断。
- **摘要**：通过精选后，用 DeepSeek 生成中文标题、概要和要点（只根据抓到的内容，不编造）。
- **兜底**：抓不到正文（站点拒绝、需要登录、超时）时，用 X 卡片里的标题和封面显示；X 长文（x.com/i/article）仍显示为链接卡片。
- 配置在 `config/digest.yaml` 的 `links`：可关闭抓取或摘要，调整超时，设置不抓取的域名。

## 邮件版式

- **主题标签页**（`mail.tabs`）：苹果邮件（Mac / iPhone）、163 网页版等可以点主题标签切换；QQ 邮箱、Gmail 网页版等不支持，自动按主题依次排列，顶部是可跳转的主题目录。
- **条数和大小**：通过精选的推文都会放进邮件（最多 `digest.total_items`，默认 60 条，按分数排序）。超过 `mail.max_kb`（默认 95KB，Gmail 超过约 102KB 会折叠末尾）时分成几封发送，标题注明 1/2、2/2，最多 `mail.max_parts` 封（默认 3）。分满了仍放不下时，去掉分数最低的条目（每个主题至少留一条），邮件里只有完整卡片；日志会写"因篇幅去掉 N 条低分内容"，去掉的不算已发送。`max_parts: 1` 时不分卷，同样去掉低分条目。
- **内容呈现**：推文正文完整显示；引用较长或被截断时显示 AI 摘要和要点；多图一张一行、点开是大图；外部文章以小字标题 + AI 概要呈现。
- `pnpm email:test --to 邮箱1,邮箱2` 用某一期的真实内容发测试邮件，顶部会显示该邮箱是否支持标签页。

## 反馈（赞 / 踩）

### 后台预览里的赞 / 踩（现在用的方式）

管理员在推送详情（`/admin/deliveries/<日期>`）点某位订阅者的"预览"或"已发出的"，打开的邮件预览里每条卡片底部最左边有灰色的"赞 · 踩"（只在后台预览里有，邮件里没有）。

- 点一下立即记录，不跳转、不确认；选中的变色加粗，再点一次同一个取消，点另一个就改成另一个。
- 踩了之后这条下面出现原因（话题不感兴趣 / 不喜欢这个作者 / 内容太浅 / 像广告或推广 / 重复 / 其他，可不选）和一个说明框，选原因或点"保存"即更新。赞不需要原因。
- 每条推文只留一条后台评价（`feedback` 表 `source = admin`），重新打开预览会显示之前的评价、原因和说明。
- 用来改进评审规则：`pnpm feedback --summary`（默认最近 7 天，或 `--days 14`、`--from 2026-10-20 --to 2026-10-26`）列出每条踩的账号、主题、类别、分数、AI 当时的判断理由、你选的原因和说明，以及按账号 / 主题 / 类别 / 原因的计数。

### 邮件里的反馈链接（默认关闭）

`config/digest.yaml` 的 `mail.feedback: true` 时，每条推文底部最左边带灰色的"赞 · 踩"链接（需要网站能从外网打开，见下面的"上线"）。

- 点开是网站上的确认页（`/f`），预先选好了赞或踩，踩时可以选原因，点"确认"才记录。邮箱的安全扫描会预先打开链接，所以打开页面本身不算数。
- 单独发送的邮件：链接带订阅者的专属 token（和管理订阅链接相同），同一人对同一条重复反馈会覆盖上一次。
- 合并发送的邮件：不知道是谁点的，记为匿名；链接带用 `.env` 的 `FEEDBACK_SECRET` 算出的签名，防止伪造。没设置 `FEEDBACK_SECRET` 时合并邮件不放反馈链接。
- 查看（两种反馈都在）：管理页 `/admin/feedback`，或 `pnpm feedback`（`--down` 只看 👎，`--summary` 汇总）。反馈暂时不直接参与选稿，由人根据汇总调整评审规则。
- 试用：`pnpm email:test --to 你的邮箱 --feedback` 发一封带反馈链接的测试邮件（收件人必须是订阅者，点了会真的记录）。

## 发信与合并发送

主题组合和阅读语言完全相同的订阅者，收到的内容完全一样。默认把他们合并成一封邮件：只渲染一次，
收件人放在密送（BCC）里，每封最多 `bcc_batch_size` 人（默认 20），超过分成多封。例如 100 个订阅者只有 6 种"主题 + 语言"组合时，
每天只需发 6–10 封邮件，而不是 100 封。

- 合并邮件不能放每个人专属的链接，页脚的"管理订阅 / 切换语言 / 退订"指向通用页面 `/manage`：输入邮箱后，系统把专属链接发到这个邮箱（同一邮箱 5 分钟内只发一次，且不透露邮箱是否订阅过）。
- 某个组合只有一个人时仍单独发送，带专属链接和一键退订（`List-Unsubscribe-Post`）。
- 发送记录按人保存，同一天重复运行不会重发；某封失败只影响这一批收件人，下次运行会补发。
- **管理员提醒**：`.env` 设置了 `ADMIN_EMAIL` 时，今天没有采集、采集中途停止、登录失效、有账号不存在、有订阅者发送失败时（`daily.sh`），以及到截止时间仍连不上 X、额度用完暂停时（`daily-auto.sh`），会发一封提醒邮件；`pnpm notify "标题" "正文"` 可以手动发。
- 在 `config/digest.yaml` 的 `mail` 中调整：`group_identical: false` 关闭合并，`bcc_batch_size` 调整每封人数。

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

## 上线

- **在本机上线（Cloudflare Tunnel）**：网站由 launchd 常驻运行（`agents/com.xrss.web.plist` → `scripts/web.sh`，`next start` 只监听 `127.0.0.1:3000`），Cloudflare Tunnel 把一个子域名转发到 `127.0.0.1:3000`，`.env` 的 `SITE_URL` 设为这个地址；数据库继续用本机的 `data/app.db`。步骤见 [agents/script-mode.md](../agents/script-mode.md) 第 6 节。Mac 关机或断网时网站打不开
- **部署到云端**：
  - 数据库：把 `DATABASE_URL` 换成 Turso 地址，本机流水线和线上网站共用
  - 网站：`apps/web` 可部署到 Vercel 等平台；设置 `SITE_URL`、`SMTP_*`、`MAIL_FROM`，并把 `config/` 目录一起部署（或设置 `CONFIG_DIR`）
- 邮件：QQ 邮箱 SMTP（`smtp.qq.com:465`），逐封发送并间隔 1.5 秒；QQ 邮箱对每日发信量有限制，订阅者多了以后建议换企业邮箱或专业发信服务

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有单元测试 |
| `pnpm typecheck` | 类型检查 |
| `pnpm schema` | 修改采集数据格式后重新生成 JSON Schema |
| `pnpm plan` | 生成今天的采集清单 |
| `pnpm crawl:chrome` / `pnpm crawl:auto` | 打开采集专用的 Chrome / 按清单脚本采集（`--trial N` 试采） |
| `pnpm crawl progress` / `pnpm crawl:status` | 今天的采集进度 / 冷却期、最近异常和用量 |
| `pnpm crawl:reset` / `pnpm crawl:resume` | 重新登录后解除暂停 / 解除冷却并从出错的那一步接着采 |
| `pnpm accounts` | 账号分档（优质 / 普通 / 低质） |
| `scripts/daily-auto.sh` | 完整的每日任务（launchd 每天 08:00 调用） |
| `scripts/daily.sh [--dry-run]` | 采集完成后的处理和发信 |
| `pnpm subscribers` / `pnpm resend` / `pnpm notify` | 订阅者 / 推送历史和重新推送 / 给管理员发提醒 |
| `pnpm feedback` | 赞 / 踩反馈（`--summary` 汇总最近 7 天的踩） |
| `pnpm --filter @xrss/core db:generate` | 修改表结构后生成迁移文件 |
