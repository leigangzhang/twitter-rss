# 每日 X 采集任务（交给装有 Browser Skill 的 Agent 执行）

你要用 Browser Skill 操作本机 Chrome（已登录 X 的专用账号），按采集清单抓取博主的新推文，并按约定格式写成文件。

## 输入

读取 `data/inbox/<今天日期>/plan.json`（由 `pnpm plan` 生成），其中：

- `accounts`：要访问的账号，已随机打乱，按顺序处理
- `since`：只要这个时间之后发布的推文
- `lastSeenId`：上次采集到的最新推文 ID，遇到它或更早的推文就停止
- `pacing`：节奏要求（停留时间、滚动间隔、最大滚动屏数）

## 对每个账号

1. 打开 `account.url`，等待时间线加载完成。
2. **优先读取网络响应**：如果 Browser Skill 能拿到页面的网络请求，找到地址里包含 `UserTweets` 的 GraphQL 响应，把每次响应的 JSON 原样保存到 `data/inbox/<日期>/raw/<handle>-<序号>.json`。
3. 按 `pacing.scrollPauseMs` 的随机间隔向下滚动，直到满足任一条件：
   - 出现了 `lastSeenId` 或比它更早的推文
   - 出现了早于 `since` 的推文（置顶推文除外）
   - 滚动次数达到 `pacing.maxScrolls`
4. 对需要展开的 Thread（作者连续回复自己、且时间线上没显示全），打开该推文详情页，保存 `TweetDetail` 响应到同一 raw 目录。没有必要时不要打开详情页。
5. 处理完一个账号后，随机停留 `pacing.delaySec` 范围内的秒数，再处理下一个。

## 输出

- **读取到网络响应时**：对每个账号运行
  `pnpm --filter @xrss/collector parse --handle <handle> data/inbox/<日期>/raw/<handle>-*.json`
  它会生成标准文件 `data/inbox/<日期>/<handle>.json`。
- **只能读取页面内容时**：直接按 `schemas/inbox-file.schema.json` 写出 `data/inbox/<日期>/<handle>.json`。要求：
  - `text` 必须是完整正文（长推文要点开"显示更多"）
  - 图片填图片地址，视频填封面地址和时长
  - 引用推文填进 `quoted`，作者本人的 Thread 后续推文填进 `thread`
  - 数字按页面显示换算（"2.3万"→23000，"1.2K"→1200）

## 必须立即停止的情况

遇到以下任一情况，**不要重试、不要尝试绕过**，把当前账号写成状态文件后结束整个任务：

| 页面现象 | 写入的 status |
|---|---|
| "Rate limit exceeded"、内容加载不出 | `rate_limited` |
| 跳转到登录页、提示重新登录 | `login_required` |
| 出现人机验证 / 验证码 | `captcha` |
| 其他异常 | `error`（在 `error` 字段写明现象） |

状态文件示例：

```json
{ "source": "tencent-browser-skill", "collectedAt": "2026-10-18T22:31:00Z", "handle": "someone", "status": "rate_limited", "tweets": [] }
```

## 其他约束

- 只浏览，不点赞、不转发、不关注、不发帖，不点击广告。
- 不访问清单以外的账号。
- 不修改浏览器和 X 账号的任何设置。
