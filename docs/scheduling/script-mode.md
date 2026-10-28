# 脚本版每日任务（不需要 AI Agent）

每天的流程不变：生成采集清单 → 逐个采集 → AI 精选并发邮件。区别只在"操作浏览器"这一步：
由 `pnpm crawl:auto` 连接一个采集专用的 Chrome 完成，不再需要 DeepSeek Harness 等 Agent。
采哪些账号、等多久、遇到什么情况停止，和 Agent 版用的是同一份清单、同一套规则（见 `config/crawl.yaml` 和 [节流、额度与容量](../performance/limits.md)）。
采集本身的细节见 [采集](../features/collection.md)。

和 Agent 版相比：
- 每一步由代码执行，不会因为模型理解错指令而卡住或误报；
- 完整保存 X 的网络响应（Browser Skill 有 256 KiB 上限），时间线响应里就带长推文全文，基本不用再开详情页；
- 由 macOS 的 launchd 定时启动，不依赖任何 App 开着。

Agent 版（[agent-mode.md](agent-mode.md)）保留作备用，两者共用同一份进度，同一天不要同时运行。

## 1. 准备采集专用的 Chrome（一次性）

```bash
pnpm crawl:chrome
```

会用独立的用户资料（默认 `~/.xrss-chrome`，调试端口 9333）打开一个新的 Chrome 窗口，在里面登录**采集用的 X 账号**（建议专用小号）。
它和你日常用的 Chrome 是两套资料，Cookie、登录状态互不影响。
尽量不要在两套资料里交叉登录同一组账号：两个账号共用一套 Cookie 时，X 容易把它们关联起来。

这个 Chrome 启动时只带了独立资料和一个只监听本机的调试端口，没有任何自动化参数，页面看到的就是一个普通的 Chrome。
新号建议先手动用几天（补全资料、关注几个账号、正常刷一刷），再开始每天自动采集；新号额度不稳定时，可以先用老账号跑一段时间再切回来。
手动操作（浏览、关注）和采集至少隔开 60 分钟，见 [节流、额度与容量](../performance/limits.md#x-接口额度)。

## 2. 试采

```bash
pnpm crawl:auto --trial 5                              # 随机挑 5 个账号
pnpm crawl:auto --trial 3 --accounts dotey,op7418,vista8   # 指定账号（挑常发长文的，看长推文是不是全文）
```

结果放在 `data/trial/<时间>/`，不影响正式进度和冷却状态。结束时输出每个账号拿到的推文数，以及长推文是全文还是仍被截断。

## 3. 网络自检（WireGuard）

`scripts/net-check.sh` 先检查能不能访问 x.com，不通时用 `scutil --nc start` 连接 WireGuard 隧道，最多等 2 分钟。
在 `.env` 里写上隧道名（WireGuard App 左侧列表里的名字）：

```
WG_TUNNEL=你的隧道名
ADMIN_EMAIL=你的邮箱      # 连不上、采集停止、发送失败时收到提醒
```

更省心的做法是在 WireGuard App 里给这个隧道打开"按需连接（On-Demand）"，系统会一直保持连接，自检基本不会触发。

## 4. 每天定时运行

```bash
scripts/daily-auto.sh        # 先手动跑一次完整流程
```

确认正常后，编辑 [`agents/com.xrss.auto.plist`](../../agents/com.xrss.auto.plist) 里的项目路径，然后：

```bash
cp agents/com.xrss.auto.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.xrss.auto.plist
sudo pmset repeat wakeorpoweron MTWRFSU 07:55:00     # 每天 07:55 唤醒 Mac，08:00 准时运行
```

采集清单里排好了开始前随机等待 0–20 分钟（`crawl.yaml` 的 `start_jitter_min`），所以实际在 08:00–08:20 开始访问 X；采集通常 30–60 分钟，之后精选和发信。
采集专用的 Chrome 要一直开着并保持登录。

同时停用 DeepSeek Harness 里的定时任务，避免两边同时采集。

`pnpm crawl:auto` 的退出码：0 完成；2 因限流、验证码、登录失效等停止；3 今天不采集；5 本机网络不通（暂停，恢复后重新运行接着采）；6 额度用完暂停（不冷却）；1 其他错误。

`daily-auto.sh` 的处理：

| 情况 | 处理 |
|---|---|
| 连不上 x.com | 自动连接 WireGuard；仍不通每 15 分钟重试，到 10 点仍不通发提醒，用已有内容照常发送 |
| 采集中途断网 | 等网络恢复后从断点接着采 |
| 某个账号页面没加载出来 | 放到最后重试一次；同一账号再失败或连续两个账号失败才停止 |
| 账号不存在、被冻结 | 跳过这个账号，提醒你改 `config/topics.yaml` |
| 接口额度不够（X 响应头 `x-rate-limit-*`） | 20 分钟内能恢复就等到重置再继续；更久就暂停采集（退出码 6，不冷却），已采到的内容照常发送，发提醒 |
| 限流、验证码、登录失效 | 立即停止采集并进入冷却，已采到的内容照常发送，发提醒 |
| 采集进程意外中断 | `daily.sh` 发现清单没采完时再接着采一次 |

日志：`data/logs/auto-<日期>.log`（总流程）、`data/logs/<日期>.log`（精选和发送）。
登录失效时：运行 `pnpm crawl:chrome`，在采集专用的 Chrome 里重新登录采集用的 X 账号，然后 `pnpm crawl:reset`。

## 5. 限流与额度

只有采集用到的接口返回 429 才算限流；按 X 响应头里的额度控制节奏；每一步的接口和额度记在 `data/inbox/<日期>/calls.jsonl`。
详细规则见 [节流、额度与容量](../performance/limits.md)，出问题时怎么处理见 [日常运维](../maintenance/operations.md#常见问题)。

网站常驻运行和对外访问（Cloudflare Tunnel）见 [上线部署](../maintenance/deployment.md)。
