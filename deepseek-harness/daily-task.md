# X 精选晨报 · 每日定时任务（DeepSeek Harness）

> 把下面"任务提示词"整段粘贴到 DeepSeek Harness 的定时任务里。安装方式见本文末尾。

## 任务提示词

```text
你负责运行"X 精选晨报"的每日任务。项目目录：/Users/ray/Workspace/twitter-rss，所有命令都在这个目录执行。

这是无人值守的定时任务。无论是定时触发还是我手动触发，都要完整执行：不要为了尽快出结果缩小采集范围、只采样、跳过等待或合并步骤。采集通常需要 50–90 分钟，这是正常的。采哪些账号、按什么顺序、每步等多久，都由脚本决定，你只负责照做。

1. 生成采集清单：运行 `pnpm plan`。退出码为 3 时今天不采集（冷却期、登录失效或非允许时段），不要打开浏览器，直接执行第 3 步，并在汇报开头说明原因。

2. 采集：先完整阅读 `packages/collector/AGENT_PROMPT.md`，然后重复下面的循环，直到输出 FINISHED、STOP 或 SKIP：
   a. 运行 `pnpm -s crawl next`。
   b. 输出 WAIT：立即再运行一次 `pnpm -s crawl next`（它自己会等待），不要自己 sleep，也不要跳过。
   c. 输出 STEP：用 Browser Skill 完成它列出的操作（打开页面、原样保存网络响应、按给定停顿滚动），然后运行它给出的 `pnpm -s crawl done <key>`。
   d. done 输出 NOT_DONE：按提示补做这一步，再运行 done；输出 OK：回到 a。
   e. 遇到限流、验证码、登录失效：运行 `pnpm -s crawl done <key> --status rate_limited|captcha|login_required|error --error "页面提示"`，然后结束循环，不要重试或绕过。
   不要自己挑选或跳过账号，不要自己写 data/inbox 下的文件代替网络响应（AGENT_PROMPT.md 里说明了确实拿不到响应时怎么做）。只浏览，不点赞、不转发、不关注、不发帖。

3. 精选并发送：运行 `scripts/daily.sh`（不要加 --dry-run）。
   - 退出码 4：采集还没完成，回到第 2 步继续，不要用其他命令绕过它发送；
   - 退出码 2：采集端遇到了限流或登录问题，仍会正常处理已采到的内容。

4. 汇报（几行中文）：`pnpm -s crawl progress` 的第一行（采集账号数、详情页数）、时间范围内推文数、初审通过/剔除数、终审去重数、发送成功/失败数，附精选报告 `data/out/<今天>/curation.md`。
   今天跳过了采集、采集因异常停止、或 daily.sh 退出码为 2 时，在汇报开头单独提醒并附上 `pnpm crawl:status` 的输出；登录失效时提醒我重新登录 X 后运行 `pnpm crawl:reset`。
   当天没有合格内容而没有发送时如实说明，不要强行发送。
```

## 安装

1. **Browser Skill**：按 https://github.com/Tencent/BrowserSkill 安装 `bsk` 命令和浏览器扩展，
   运行 `bsk install-skill` 选择 DeepSeek Harness，再用 `bsk doctor` 确认连接正常。
   浏览器里登录采集专用的 X 账号。
2. **模型**：在 DeepSeek Harness 的 desktop 或 web profile 中把模型设为 `deepseek-flash`，并启用 Browser Skill。
3. **定时任务**：在同一个 profile 中新建定时任务：
   - 时间：每天 06:30（北京时间）。`pnpm crawl next` 会先随机等待 0–20 分钟，加上采集节奏（通常 50–90 分钟），邮件大约 8:00–8:30 发出；
   - 工作目录：`~/Workspace/twitter-rss`；
   - 提示词：上面"任务提示词"一节的全部内容。
4. **先手动跑一次**：在 Harness 里直接发送这段提示词，确认采集、`scripts/daily.sh` 和汇报都正常，再交给定时任务。
   手动跑也会完整采完清单，需要 50–90 分钟。中途打断也没关系：`pnpm -s crawl next` 会从上次停下的地方继续。

## 为什么改成逐步采集

之前把整个采集流程交给 AI 一次性执行，它会为了尽快出结果自行缩小范围（例如只采 8 个账号"样本"、跳过启动等待），
还会在没保存网络响应时自己从页面整理出不完整的文件。现在：

- 采哪个账号、等多久由 `pnpm crawl next` 决定，等待在脚本里完成，AI 无法跳过；
- `pnpm crawl done` 会检查网络响应是否真的保存、能否解析，不合格的步骤不算完成；
- 清单没采完时 `scripts/daily.sh` 不会发送（退出码 4），中途中断后再运行会从断点继续；
- 没采到的账号不会丢内容：下次轮到时会补收（见 `config/crawl.yaml` 的 `catch_up_days`）。

项目里的 AI 精选（`scripts/daily.sh` 内）不经过 Harness，直接用 `.env` 里的 `DEEPSEEK_API_KEY` 调用 `deepseek-flash`。
