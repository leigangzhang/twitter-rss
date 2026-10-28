# 采集

每天按清单打开博主主页，保存 X 网页自己发出的网络响应，解析成统一格式交给流水线。
什么时候跑、怎么定时见 [调度](../README.md#调度每天怎么自动跑)。
采集的目标是强度接近正常人浏览、尽量不触发限流，出现问题立即停下，而不是绕过检测；相关配置都在 `config/crawl.yaml`。

## 采集契约

采集端和流水线之间只约定一件事：**每个账号输出一个 `data/inbox/<日期>/<handle>.json`，格式见 `schemas/inbox-file.schema.json`**
（由 `packages/core` 的类型生成，改了格式后运行 `pnpm schema`）。采集方式以后怎么换，下游都不用改。

同一天的目录里还有：

| 文件 | 内容 |
|---|---|
| `plan.json` | `pnpm plan` 生成的采集清单：今天采哪些账号、顺序、每一步的等待时间 |
| `progress.json` | 每一步的完成情况，中断后从这里接着采 |
| `raw/<handle>-N.json` | 原样保存的网络响应（时间线、账号资料、详情页） |
| `detail-needed.json` | 需要打开详情页补抓全文的推文 |
| `calls.jsonl` / `ratelimit.json` | 每一步用到的接口、状态码和额度（脚本采集） |

`plan.json`、`progress.json`、`detail-needed.json` 由脚本维护，不要手工编辑。

## 两种采集方式

两种方式共用同一份清单、进度和规则（`config/crawl.yaml`），同一天不要同时运行。

- **脚本采集（默认）**：`pnpm crawl:auto` 连接采集专用的 Chrome（`pnpm crawl:chrome` 打开，独立资料 `~/.xrss-chrome`，调试端口 9333），
  按清单打开主页、滚动，把 `UserOriginalsTimeline` / `UserTweets` / `UserByScreenName` / `TweetDetail` 响应原样存到 `raw/`，再解析。
  每一步由代码执行，完整保存网络响应，不用大模型。`--trial N`（可加 `--accounts a,b`）试采，结果放在 `data/trial/<时间>/`，不影响正式进度和冷却。
  使用说明见 [脚本版每日任务](../scheduling/script-mode.md)。
- **Agent 采集（备用）**：能运行命令、能操作浏览器的 Agent 循环运行 `pnpm crawl next` 领取下一步、用浏览器做完、`pnpm crawl done <key>` 报告。
  采哪个账号、等多久由脚本决定，`done` 会检查网络响应是否真的保存、能否解析，不合格的不算完成。
  Browser Skill 抓网络数据有 256 KiB 上限，X 的时间线数据通常更大，这时 Agent 从页面读取推文（`crawl done --no-response`），入库时自动修复页面读取带来的断行。
  说明见 [Agent 版每日任务](../scheduling/agent-mode.md) 和 [`agents/crawl-loop.md`](../../agents/crawl-loop.md)。

时间线采完后自动解析并补抓需要的详情页；清单没采完时 `scripts/daily.sh` 不发送（退出码 4），`pnpm crawl progress` 查看进度。

## 长推文全文

- 时间线响应里带 `note_tweet` 时就是全文。同一个响应里有推文带 `note_tweet` 时，没带的就是完整的短推文，接近 280 字也不算截断。
- 不带时，解析按 X 的字数规则找出可能被截断的推文写入 `detail-needed.json`，采集端再打开这些推文的详情页，保存 `TweetDetail` 响应后重新解析，全文自动合并。
- 页面读取（Agent 版）的长推文同样补抓详情页。
- 没补抓到的推文在邮件里会提示"全文较长"。

## 入库时的整理

`scripts/daily.sh` 先把收件箱解析入库（`packages/pipeline/src/ingest.ts`）：

- 按推文 ID 去重，合并作者本人的连续推文（Thread）和长文全文；
- 修好页面读取带来的断行（链接、@账号被拆开）；
- 还原没展开的 t.co 短链：真实地址只出现在链接文字或正文里时，用它还原，这样外部文章也能抓取和摘要；
- 记录账号资料（头像、显示名），订阅页的头像来自这里；
- 跳过收件箱里的 `ratelimit.json` 等非账号文件。

## 采集预算

| 配置（`crawl.yaml`） | 默认 | 作用 |
|---|---|---|
| `budget.max_accounts_per_run` | 50 | 每次最多采多少个账号；超过时按"超期最多"优先轮转 |
| `budget.max_page_loads_per_run` | 80 | 每次打开页面总数上限（主页 + 详情页） |
| `budget.max_detail_per_run` | 25 | 详情页补抓上限，按互动量从高到低 |
| `budget.max_scrolls_per_account` | 6 | 每个主页最多向下滚动几次 |

## 节奏和频率

- **节奏**：`pnpm plan` 用随机数预先排好开始前的等待（`start_jitter_min`，0–20 分钟）、每个主页之间的停留（`pacing.account_delay_sec`，8–25 秒）、
  每次滚动的停顿和中途长休息（每 6–10 个页面休息 1–3 分钟），采集端照做即可；账号顺序每天打乱，同一账号的详情页不连续打开。
- **时段**：只在 `active_hours`（默认 6–23 点）内开始采集。
- **频率**：同一账号两次采集至少间隔 `min_interval_hours`（20 小时）；只看前一天的内容。
- 一次完整采集（50 个账号）通常 30–60 分钟，这是有意放慢的节奏。

## 账号分档和轮转

- **轮转不丢内容**：每个账号记录已入库内容覆盖到的时间点，下次采集时从那里补收（最多往回 `catch_up_days` 天，默认 4 天），补收的内容和当天内容一起评审、进入当天邮件。
- **按质量决定采集频率**：按最近 14 天 AI 评审的保留率把账号分成优质、普通、低质、不活跃，优质每次都采、低质约 3 天一次（`account_quality`）。
  分档规则、建议移出和账号降权见 [默认博主 · 账号内容质量管理](accounts.md#账号内容质量管理)。

## X 接口额度

X 在每个响应头里给出接口额度（`x-rate-limit-limit / -remaining / -reset`，按 15 分钟窗口）。脚本采集（`crawl:auto`）据此控制节奏：

- 每一步前估算要用的请求数；额度不够且 20 分钟内重置时，等到重置再继续；
- 要等更久时暂停采集（退出码 6，不算异常、不冷却），`daily-auto.sh` 用已采到的内容照常发送并发提醒；
- 时间线额度只剩 1 次时不再滚动；
- 每一步打开了哪些接口、状态码、剩余额度和重置时间记在 `data/inbox/<日期>/calls.jsonl`；最近一次看到的额度存在同目录的 `ratelimit.json`，同一天重新运行时接着用。

2026-10-26 实测的 15 分钟额度：`UserOriginalsTimeline` 250、`UserByScreenName` 150；主页附带的 `ViewerBadgeCounts` 只有 50（不影响采集）。

同一个账号的额度是所有操作共用的：手动浏览、关注等操作和采集至少隔开 60 分钟。

## 熔断与冷却

- **什么算限流**：只有采集用到的接口（`UserByScreenName`、`UserTweets`、`UserOriginalsTimeline`、`TweetDetail`）返回 429、或页面提示限流才算；
  主页上推荐关注、侧边栏等附带请求的 429 只记录，不停止。
- 遇到限流、验证码、登录失效立即停止并写入状态，进入冷却期（`cooldown`）：

  | 情况 | 冷却 |
  |---|---|
  | 限流 / 内容加载不出 | 24 小时 |
  | 人机验证 | 48 小时 |
  | 其他异常（同一账号重试仍失败、或连续两个账号失败） | 6 小时，不随次数加倍 |
  | 登录失效 | 人工暂停，重新登录后 `pnpm crawl:reset` |

  连续出现限流、验证码时冷却期按 `backoff_multiplier`（2）加倍，最长 `max_hours`（7 天）。
- 冷却期内 `pnpm plan` 以退出码 3 结束，定时任务不会打开浏览器，流水线照常处理已有内容。
- 本机断网不算异常：暂停（退出码 5），网络恢复后接着采。被误记成异常时用 `pnpm crawl:resume` 解除冷却。
- 状态保存在 `data/crawl-state.json`，`pnpm crawl:status` 查看冷却期、最近异常和用量。

单个账号出问题时不停止整轮采集：

- **账号不存在、已改名或被冻结**：跳过这个账号（不停止、不冷却），提醒改 `config/topics.yaml`。
- **页面没加载出来等其他错误**：先放到最后几分钟后重试一次；同一账号再失败或连续两个账号失败才停止（冷却 6 小时）。
- 限流、验证码、登录失效时流水线照常处理已采到的内容，`scripts/daily.sh` 退出码为 2。

## 只读、不对抗

- 只打开清单里的主页和推文，不点赞、不转发、不关注、不回复、不发帖；
- 不伪装浏览器指纹、不换 IP 或代理、不轮换多个账号、不自动处理验证码；
- 采集专用的 Chrome 只带独立资料和一个只监听本机的调试端口，没有任何自动化参数。

> 用浏览器自动化抓取 X 不符合 X 的服务条款，请自行评估风险，仅用于个人或小范围场景。
