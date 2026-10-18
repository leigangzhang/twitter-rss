# 每日 X 采集任务（交给装有 Browser Skill 的 Agent 执行）

你要用 Browser Skill（https://github.com/Tencent/BrowserSkill）操作本机 Chrome（已登录 X 的专用账号），按采集清单抓取博主**前一天**发布的推文，并按约定格式写成文件。

## 输入

读取 `data/inbox/<今天日期>/plan.json`（由 `pnpm plan` 生成），其中：

- `accounts`：要访问的账号，已随机打乱，按顺序处理
- `since` / `until`：只要在这个时间段内发布的推文（默认是前一天北京时间 0:00–24:00；`contentDate` 是这一天的日期）
- `lastSeenId`：上次采集到的最新推文 ID，遇到它或更早的推文就停止
- `pacing`：节奏要求（停留时间、滚动间隔、最大滚动屏数）

## 第一步：采集时间线

对每个账号：

1. 打开 `account.url`，等待时间线加载完成。
2. **读取网络响应**：找到地址里包含 `UserOriginalsTimeline`（个人主页"帖子"页当前实际使用的接口）或 `UserTweets` 的 GraphQL 响应，把每次响应的 JSON 原样保存到 `data/inbox/<日期>/raw/<handle>-<序号>.json`。
3. 按 `pacing.scrollPauseMs` 的随机间隔向下滚动，直到满足任一条件：
   - 出现了 `lastSeenId` 或比它更早的推文
   - 出现了早于 `since` 的推文（置顶推文除外）
   - 滚动次数达到 `pacing.maxScrolls`

   晚于 `until` 的推文（今天新发的）不用管，明天会采集到。
4. 处理完一个账号后，随机停留 `pacing.delaySec` 范围内的秒数，再处理下一个。

全部账号处理完后运行：

```bash
pnpm --filter @xrss/collector parse
```

它会为每个账号生成 `data/inbox/<日期>/<handle>.json`，并生成补抓清单 `data/inbox/<日期>/detail-needed.json`。

## 第二步：补抓详情页

时间线接口是精简数据：**长推文只给前 280 字符左右，X 长文没有标题和摘要**。`detail-needed.json` 列出了时间范围内需要补抓的推文：

```json
{ "total": 3, "targets": { "someone": [{ "id": "…", "url": "https://x.com/someone/status/…", "reason": "truncated" }] } }
```

对清单里的每一条：

1. 打开它的 `url`（推文详情页），等待加载完成。
2. 找到地址里包含 `TweetDetail` 的 GraphQL 响应，原样保存到 `data/inbox/<日期>/raw/<handle>-detail-<id>.json`。
3. 不需要滚动，不需要展开评论。每条之间随机停留 `pacing.delaySec` 范围内的秒数。

全部补抓完后**再运行一次** `pnpm --filter @xrss/collector parse`。解析器会自动把详情页里的全文、长文标题合并进来，`detail-needed.json` 中的 `total` 应该变为 0 或明显减少。补抓失败的推文不影响后续流程，邮件里会提示"全文较长，在 X 上阅读全文"。

## 只能读取页面内容时

如果拿不到网络响应，直接按 `schemas/inbox-file.schema.json` 写出 `data/inbox/<日期>/<handle>.json`。要求：

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
- 不访问清单以外的账号和推文。
- 不修改浏览器和 X 账号的任何设置。
