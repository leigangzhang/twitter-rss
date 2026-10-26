# 脚本版每日任务（不需要 AI Agent）

每天的流程不变：生成采集清单 → 逐个采集 → AI 精选并发邮件。区别只在"操作浏览器"这一步：
由 `pnpm crawl:auto` 连接一个采集专用的 Chrome 完成，不再需要 DeepSeek Harness 等 Agent。
采哪些账号、等多久、遇到什么情况停止，和 Agent 版用的是同一份清单、同一套规则（见 `config/crawl.yaml`）。

和 Agent 版相比：
- 每一步由代码执行，不会因为模型理解错指令而卡住或误报；
- 完整保存 X 的网络响应（Browser Skill 有 256 KiB 上限），时间线响应里就带长推文全文，基本不用再开详情页；
- 由 macOS 的 launchd 定时启动，不依赖任何 App 开着。

Agent 版（[README.md](README.md)）保留作备用，两者共用同一份进度，同一天不要同时运行。

## 1. 准备采集专用的 Chrome（一次性）

```bash
pnpm crawl:chrome
```

会用独立的用户资料（默认 `~/.xrss-chrome`）打开一个新的 Chrome 窗口，在里面**只登录 X 小号**。
它和你日常用的 Chrome 是两套资料，Cookie、登录状态互不影响，大号继续在日常的 Chrome 里用。
不要在这个窗口里登录大号，也不要在日常的 Chrome 里登录小号：两个账号共用一套 Cookie 时，X 容易把它们关联起来。

这个 Chrome 启动时只带了独立资料和一个只监听本机的调试端口，没有任何自动化参数，页面看到的就是一个普通的 Chrome。
新号建议先手动用几天（补全资料、关注几个账号、正常刷一刷），再开始每天自动采集。

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

确认正常后，编辑 [`com.xrss.auto.plist`](com.xrss.auto.plist) 里的项目路径，然后：

```bash
cp agents/com.xrss.auto.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.xrss.auto.plist
sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00     # 每天 05:55 唤醒 Mac，06:00 准时运行
```

同时停用 DeepSeek Harness 里的定时任务，避免两边同时采集。

`daily-auto.sh` 的处理：

| 情况 | 处理 |
|---|---|
| 连不上 x.com | 自动连接 WireGuard；仍不通每 15 分钟重试，到 10 点仍不通发提醒，用已有内容照常发送 |
| 采集中途断网 | 等网络恢复后从断点接着采 |
| 某个账号页面没加载出来 | 放到最后重试一次；同一账号再失败或连续两个账号失败才停止 |
| 账号不存在、被冻结 | 跳过这个账号，提醒你改 `config/topics.yaml` |
| 限流、验证码、登录失效 | 立即停止采集并进入冷却，已采到的内容照常发送，发提醒 |
| 采集进程意外中断 | `daily.sh` 发现清单没采完时再接着采一次 |

日志：`data/logs/auto-<日期>.log`（总流程）、`data/logs/<日期>.log`（精选和发送）。
登录失效时：运行 `pnpm crawl:chrome`，在采集专用的 Chrome 里重新登录小号，然后 `pnpm crawl:reset`。
