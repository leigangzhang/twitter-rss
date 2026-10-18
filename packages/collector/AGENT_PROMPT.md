# 每日 X 采集任务（由 DeepSeek Harness 定时任务调用 Browser Skill 执行）

你要用 Browser Skill（https://github.com/Tencent/BrowserSkill，工具名为 `bsk_*`）操作本机 Chrome（已登录 X 的专用账号），按采集清单抓取博主**前一天**（以及上次没轮到的那几天）发布的推文，并按约定格式写成文件。

**最重要的原则：慢、少、遇到问题就停。** 清单里的等待时间、滚动次数、页面数上限都已经算好，照做即可，不要为了加快速度省略等待，也不要多开页面。

## 输入

读取 `data/inbox/<今天日期>/plan.json`（由 `pnpm plan` 生成）：

| 字段 | 含义 |
|---|---|
| `skip` | **不为 null 时今天不采集**：不要打开浏览器，直接结束并汇报 `skip.reason` |
| `startDelaySec` | 开始前先等待的秒数 |
| `budget.maxPageLoads` | 本次最多打开的页面数（主页 + 详情页），到达后立即结束 |
| `accounts` | 已排好顺序的账号，每个带 `waitBeforeSec`、`longBreakBeforeSec`、`scrollPausesMs` |
| `since` / `until` | 本次的时间范围（前一天北京时间 0:00–24:00），晚于 `until` 的推文不要 |
| `accounts[].since` | **每个账号自己的起点**：上次没轮到的账号会早于全局 `since`，要把这几天的推文也收进来 |
| `lastSeenId` | 遇到这个 ID 或更早的推文就停止滚动 |

等待用 shell 命令 `sleep <秒数>`，不要用其他方式代替。

## 第一步：采集时间线

1. 先 `sleep <startDelaySec>`。
2. 按 `accounts` 的顺序，对每个账号：
   1. 如果 `longBreakBeforeSec` 大于 0，先 `sleep <longBreakBeforeSec>`；再 `sleep <waitBeforeSec>`。
   2. 在**同一个标签页**里打开 `url`，等待时间线加载完成。不要同时打开多个标签页。
   3. 读取网络响应：地址里包含 `UserOriginalsTimeline`（个人主页"帖子"页）或 `UserTweets` 的 GraphQL 响应，原样保存到 `data/inbox/<日期>/raw/<handle>-<序号>.json`；打开主页时地址里包含 `UserByScreenName` 的响应（账号资料，含头像）保存为 `raw/<handle>-profile.json`，前一天没发推的账号也要保存。
   4. 按 `scrollPausesMs` 依次向下滚动：每次滚动前等待对应的毫秒数，数组用完就不再滚动。满足以下任一条件时提前停止滚动：
      - 出现了 `lastSeenId` 或更早的推文；
      - 出现了早于这个账号 `since`（`accounts[].since`，不是全局的 `since`）的推文（置顶推文除外）。

      晚于 `until` 的推文（今天新发的）不用管，明天会采集到。
   5. 每打开一个页面计数加 1；达到 `budget.maxPageLoads` 立即结束采集。
3. 全部完成后运行：

```bash
pnpm --filter @xrss/collector parse
```

## 第二步：补抓详情页

时间线接口不含长推文全文和 X 长文标题，需要打开详情页补抓。读取 `data/inbox/<日期>/detail-needed.json`：

- `stop` 不为 null：**不要再打开任何页面**，直接进入汇报。
- `scheduled`：已经按预算和优先级排好的推文。对每一条：如果 `longBreakBeforeSec` 大于 0 先休息，再 `sleep <waitBeforeSec>`，然后在同一个标签页打开 `url`，把地址里包含 `TweetDetail` 的响应原样保存到 `data/inbox/<日期>/raw/<handle>-detail-<id>.json`。不需要滚动，不要展开评论。
- `overBudget`：超出预算的，**不要打开**。

全部补抓完后再运行一次 `pnpm --filter @xrss/collector parse`。

## 必须立即停止的情况

遇到以下任一情况，**不要重试、不要刷新、不要换方式访问**，把当前账号写成状态文件后立即结束整个采集：

| 页面现象 | 写入的 status |
|---|---|
| "Rate limit exceeded"、"出了点问题，请稍后再试"、内容加载不出 | `rate_limited` |
| 跳转到登录页、提示重新登录、账号被锁定 | `login_required` |
| 出现人机验证 / 验证码 / "确认你是人类" | `captcha` |
| 其他异常 | `error`（在 `error` 字段写明现象） |

状态文件写到 `data/inbox/<日期>/<handle>.json`，示例：

```json
{ "source": "tencent-browser-skill", "collectedAt": "2026-10-18T22:31:00Z", "handle": "someone", "status": "rate_limited", "error": "页面提示 Rate limit exceeded", "tweets": [] }
```

然后运行一次 `pnpm --filter @xrss/collector parse`。它会记录这次异常并进入冷却期（限流 24 小时、验证码 48 小时，连续出现时加倍；登录失效需要人工处理），冷却期内 `pnpm plan` 不会再安排采集。

## 只能读取页面内容时

如果拿不到网络响应，直接按 `schemas/inbox-file.schema.json` 写出 `data/inbox/<日期>/<handle>.json`：`text` 要是完整正文（长推文点开"显示更多"），图片填地址，视频填封面和时长，引用推文填 `quoted`，作者本人的连续推文填 `thread`，数字按显示换算（"2.3万"→23000，"1.2K"→1200）。节奏要求同上。

无论有没有新推文，都要写上账号资料 `profile`：`name` 是主页上的显示名，`avatarUrl` 是主页头像图片的地址（`<img>` 的 `src`，形如 `https://pbs.twimg.com/profile_images/.../xxx_400x400.jpg`）；每条推文的 `author.avatarUrl` 也填同一个地址。订阅页靠它显示博主头像。

```json
{ "source": "tencent-browser-skill", "collectedAt": "2026-10-18T22:31:00Z", "handle": "someone", "status": "ok", "profile": { "name": "Some One", "avatarUrl": "https://pbs.twimg.com/profile_images/1/a_400x400.jpg" }, "tweets": [] }
```

## 绝对不要做的事

- 不点赞、不转发、不关注、不回复、不发帖，不点击广告。
- 不访问清单以外的账号和推文，不打开搜索、通知、私信等页面。
- 不尝试处理验证码，不切换账号，不清理 Cookie，不修改浏览器和 X 账号的任何设置。
- 不使用代理、不改变浏览器指纹、不用其他工具绕过限制。
