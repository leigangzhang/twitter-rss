# 采集

每天按清单打开博主主页，保存 X 网页自己发出的网络响应，解析成统一格式交给流水线。
什么时候跑、怎么定时见 [调度](../README.md#调度每天怎么自动跑)；节奏、额度和限流见 [节流、额度与容量](../performance/limits.md)。

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
  说明见 [Agent 版每日任务](../scheduling/agent-mode.md) 和 [`AGENT_PROMPT.md`](../../packages/collector/AGENT_PROMPT.md)。

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

## 出现问题时

- **限流、验证码、登录失效**：写入对应 `status` 并立即停止，进入冷却期（见 [节流、额度与容量](../performance/limits.md#熔断与冷却)）。流水线照常处理已采到的内容，退出码为 2。
- **账号不存在、已改名或被冻结**：跳过这个账号（不停止、不冷却），提醒改 `config/topics.yaml`。
- **页面没加载出来等其他错误**：先放到最后几分钟后重试一次；同一账号再失败或连续两个账号失败才停止（冷却 6 小时）。
- **本机断网**：暂停（PAUSE / 退出码 5），网络恢复后从断点接着采，不算异常、不冷却。被误记成异常时用 `pnpm crawl:resume` 解除冷却接着采。

## 只读、不对抗

- 只打开清单里的主页和推文，不点赞、不转发、不关注、不回复、不发帖；
- 不伪装浏览器指纹、不换 IP 或代理、不轮换多个账号、不自动处理验证码；
- 采集专用的 Chrome 只带独立资料和一个只监听本机的调试端口，没有任何自动化参数。

> 用浏览器自动化抓取 X 不符合 X 的服务条款，请自行评估风险，仅用于个人或小范围场景。
