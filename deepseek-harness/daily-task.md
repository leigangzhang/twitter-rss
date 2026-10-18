# X 精选晨报 · 每日定时任务（DeepSeek Harness）

> 把下面"任务提示词"整段粘贴到 DeepSeek Harness 的定时任务里。安装方式见本文末尾。

## 任务提示词

你负责运行"X 精选晨报"的每日流程。项目目录：`~/Workspace/twitter-rss`（以下命令都在这个目录下执行）。
今天的日期以北京时间为准，记为 `<今天>`（格式 YYYY-MM-DD）。

**第 1 步：生成采集清单**

```bash
pnpm plan
```

它会生成 `data/inbox/<今天>/plan.json`，里面是今天要采集的账号、时间范围（前一天北京时间 0:00–24:00），
以及已经排好的等待时间和页面数上限。

**如果命令的退出码是 3**（清单里 `skip` 不为空：上次采集遇到限制正在冷却、登录失效等待人工处理、或不在允许时段），
**跳过第 2 步，不要打开浏览器**，直接执行第 3 步，并在汇报里说明原因。

**第 2 步：用 Browser Skill 采集**

阅读 `packages/collector/AGENT_PROMPT.md`，使用 Browser Skill 的工具（`bsk_*`）严格按说明执行：

1. 按清单里的等待时间（用 `sleep`）逐个打开账号主页，保存 `UserOriginalsTimeline` / `UserTweets` 的网络响应到 `data/inbox/<今天>/raw/`，账号资料 `UserByScreenName` 存为 `raw/<handle>-profile.json`（用于头像）；
2. 运行 `pnpm --filter @xrss/collector parse`；
3. 按 `data/inbox/<今天>/detail-needed.json` 的 `scheduled` 逐条打开推文详情页（`stop` 不为空时跳过），保存 `TweetDetail` 响应；
4. 再运行一次 `pnpm --filter @xrss/collector parse`。

不要省略等待，不要超过页面数上限。遇到限流、登录失效、人机验证时，按说明写入状态文件、运行一次 parse 后**立即停止采集**，
不要重试，直接进入第 3 步。只浏览，不点赞、不转发、不关注、不发帖。

**第 3 步：精选并发送**

```bash
scripts/daily.sh
```

它会入库、用 DeepSeek 做初审和编辑终审、发送邮件，日志写在 `data/logs/<今天>.log`。

**第 4 步：汇报**

用几行中文汇报：每个账号采集到的推文数、补抓详情页的条数、初审通过/剔除数、终审去重数、发送成功/失败数。
如果今天跳过了采集，或 `scripts/daily.sh` 的退出码是 2（采集端遇到了限流或登录问题），请在汇报开头单独提醒，
并附上 `pnpm crawl:status` 的输出。登录失效时提醒我：重新登录 X 后运行 `pnpm crawl:reset`。
附上精选报告的路径 `data/out/<今天>/curation.md`。

## 安装

1. **Browser Skill**：按 https://github.com/Tencent/BrowserSkill 安装 `bsk` 命令和浏览器扩展，
   运行 `bsk install-skill` 选择 DeepSeek Harness，再用 `bsk doctor` 确认连接正常。
   浏览器里登录采集专用的 X 账号。
2. **模型**：在 DeepSeek Harness 的 desktop 或 web profile 中把模型设为 `deepseek-flash`，并启用 Browser Skill。
3. **定时任务**：在同一个 profile 中新建定时任务：
   - 时间：每天 06:30（北京时间）。清单会再随机等待 0–20 分钟才开始，加上采集节奏，邮件大约 7:30 前后发出；
   - 工作目录：`~/Workspace/twitter-rss`；
   - 提示词：上面"任务提示词"一节的全部内容。
4. **先手动跑一次**：在 Harness 里直接发送这段提示词，确认采集、`scripts/daily.sh` 和汇报都正常，再交给定时任务。

项目里的 AI 精选（`scripts/daily.sh` 内）不经过 Harness，直接用 `.env` 里的 `DEEPSEEK_API_KEY` 调用 `deepseek-flash`。
