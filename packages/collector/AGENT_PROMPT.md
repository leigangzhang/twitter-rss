# 每日 X 采集任务（由命令行 Agent 调用 Browser Skill 执行，见 agents/daily-task.md）

你要用 Browser Skill（https://github.com/Tencent/BrowserSkill，`bsk` 命令 / `bsk_*` 工具）操作本机 Chrome（已登录 X 的专用账号），
把采集清单里的账号逐个采完，保存网络响应。

## 最重要的规则

1. **采集范围、顺序、等待时间都由脚本决定，你只负责照做一步、报告一步。**
   不要自己挑账号、减少账号、只采"样本"、跳过等待或合并步骤。无论这次是定时触发还是手动触发，规则都一样。
2. **整个采集通常要 30–60 分钟，这是正常的。** 不要为了尽快出结果缩小范围。
3. **慢、少、遇到问题就停。** 遇到限流、验证码、登录失效时立即报告并停止，不重试、不绕过。

## 采集循环

重复下面的循环，直到出现 `FINISHED`、`STOP` 或 `SKIP`：

1. 运行 `pnpm -s crawl next`，看输出的第一个词：

   | 输出 | 你要做的 |
   |---|---|
   | `WAIT` | 还没到下一步的开始时间。**立即再运行一次 `pnpm -s crawl next`**，它自己会等待（每次最多 90 秒）。不要自己 `sleep`，不要跳过。 |
   | `STEP` | 用 Browser Skill 完成它列出的操作（打开页面、保存响应、按给定的停顿滚动），然后运行它给出的 `pnpm -s crawl done <key>`。 |
   | `FINISHED` | 今天的采集全部完成，结束循环。 |
   | `STOP` | 已因异常停止，**不要再打开任何页面**，结束循环。 |
   | `SKIP` | 今天不采集（冷却期、登录失效等），**不要打开浏览器**，结束循环。 |

2. 运行 `pnpm -s crawl done <key>` 后看输出：

   | 输出 | 你要做的 |
   |---|---|
   | `OK` | 这一步完成，回到第 1 步。 |
   | `NOT_DONE` | 这一步没做完（通常是网络响应没保存或保存不完整）。按提示补做，再运行一次 `done`。 |

   `pnpm -s crawl progress` 可以随时查看进度。

时间线采完后，`crawl next` 会自动解析并给出需要补抓的详情页（同样是 `STEP`），全部完成后才会出现 `FINISHED`。
你不需要自己运行 `parse`。

## 保存网络响应

`STEP` 会写明要保存哪些响应、存到哪个文件：

- 账号主页：地址含 `UserOriginalsTimeline` 或 `UserTweets` 的 GraphQL 响应 → `raw/<handle>-1.json`，滚动后新出现的依次存 `-2.json`、`-3.json`……；
  地址含 `UserByScreenName` 的响应（账号资料，含头像）→ `raw/<handle>-profile.json`。前一天没发推的账号也要保存。
- 详情页：地址含 `TweetDetail` 的响应 → `raw/<handle>-detail-<id>.json`。不需要滚动，不要展开评论。
  拿不到这个响应时（例如超过 256 KiB 被标记为 body_limit）：有"显示更多"先点开，把这条推文正文元素
  `[data-testid="tweetText"]` 的 `textContent` 原样保存为纯文本 `raw/<handle>-detail-<id>.txt`，
  再运行 `pnpm -s crawl done <key> --no-response "原因"`。脚本会检查全文比截断版长，并合并进账号文件。

**原样保存完整的响应正文（JSON），不要摘录、改写或自己整理成别的格式。** `crawl done` 会解析这些文件，内容不对不会通过。

滚动时按 `STEP` 给出的停顿依次等待后再滚动；看到早于给定时间的推文（置顶推文除外）或给定 ID 的推文就停止滚动。
晚于今天 0 点的推文（今天新发的）不用管，明天会采集到。

## 拿不到网络响应时（从页面读取）

Browser Skill 的网络捕获对响应正文有 256 KiB 的上限，X 的时间线响应经常超过（会被标记为 body_limit）。
这种情况下按 `schemas/inbox-file.schema.json` 从页面内容写出 `data/inbox/<日期>/<handle>.json`，读取时注意：

- **正文用推文正文元素（`[data-testid="tweetText"]`）的 `textContent`，不要用 `innerText`**：
  `innerText` 会在链接、@账号、#话题前后多出换行，邮件里就会显示成一截一截的。
- 链接写完整地址：正文里的链接元素 `textContent` 去掉结尾的"…"就是完整地址；同时写进 `links`（`expandedUrl` 填完整地址）。
- 长推文先点"显示更多"再读，`text` 要是完整正文；图片填 `<img>` 的原始地址，视频填封面和时长。
- 引用推文填 `quoted`：引用卡片里的文字原样读取，看不全时不要自己补写。作者本人的连续推文填 `thread`。
- 数字按显示换算（"2.3万"→23000，"1.2K"→1200）。
- 一定要写账号资料 `profile`：`name` 是主页上的显示名，`avatarUrl` 是主页头像图片地址（形如 `https://pbs.twimg.com/profile_images/.../xxx_400x400.jpg`）。

```json
{ "source": "tencent-browser-skill", "collectedAt": "2026-10-19T22:31:00Z", "handle": "someone", "status": "ok", "profile": { "name": "Some One", "avatarUrl": "https://pbs.twimg.com/profile_images/1/a_400x400.jpg" }, "tweets": [] }
```

然后运行 `pnpm -s crawl done <handle> --no-response "拿不到响应的原因（如 body_limit）"`。

## 必须立即停止的情况

遇到以下任一情况，**不要重试、不要刷新、不要换方式访问**，运行对应的命令后结束循环：

| 页面现象 | 运行 |
|---|---|
| "Rate limit exceeded"、"出了点问题，请稍后再试"、内容加载不出 | `pnpm -s crawl done <key> --status rate_limited --error "页面提示"` |
| 跳转到登录页、提示重新登录、账号被锁定 | `pnpm -s crawl done <key> --status login_required --error "页面提示"` |
| 出现人机验证 / 验证码 / "确认你是人类" | `pnpm -s crawl done <key> --status captcha --error "页面提示"` |
| 其他异常 | `pnpm -s crawl done <key> --status error --error "现象"` |

它会记录异常并进入冷却期（限流 24 小时、验证码 48 小时，连续出现时加倍；登录失效需要人工处理），冷却期内不会再安排采集。

## 绝对不要做的事

- 不点赞、不转发、不关注、不回复、不发帖，不点击广告。
- 不访问 `STEP` 以外的账号和推文，不打开搜索、通知、私信等页面。同一时间只用一个标签页。
- 不尝试处理验证码，不切换账号，不清理 Cookie，不修改浏览器和 X 账号的任何设置。
- 不使用代理、不改变浏览器指纹、不用其他工具绕过限制。
- 不自己编辑 `data/inbox/<日期>/` 下的 `plan.json`、`progress.json`、`detail-needed.json`。
