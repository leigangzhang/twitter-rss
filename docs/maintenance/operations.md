# 日常运维

每天的任务自动运行（见 [脚本版每日任务](../scheduling/script-mode.md)），这里是平时要看什么、出问题怎么处理、怎么根据反馈持续调整。

## 每天看什么

1. 邮件是否收到；没收到时看 `ADMIN_EMAIL` 有没有收到提醒。
2. 后台"今日反馈"（`/admin/feedback/today`）给当天的内容点赞 / 踩，见 [订阅页与管理后台](../features/web-admin.md#反馈赞--踩)。
3. 需要时看精选报告 `data/out/<日期>/curation.md`：分数分布、每条的判断理由、账号分档。

## 日志和状态

| 位置 / 命令 | 内容 |
|---|---|
| `data/logs/auto-<日期>.log` | 脚本版每日任务的总流程（网络自检、采集、退出码） |
| `data/logs/<日期>.log` | 解析、入库、精选和发送 |
| `data/logs/agent-<日期>-<agent>.log` | Agent 版的输出 |
| `data/logs/web.log` | 常驻网站的日志 |
| `data/inbox/<日期>/calls.jsonl` | 每一步用到的 X 接口、状态码和额度，排查限流先看这里 |
| `data/out/<日期>/curation.md` | 精选报告 |
| `pnpm crawl progress` | 今天的采集进度（账号数、详情页数） |
| `pnpm crawl:status` | 冷却期、最近异常和用量（`data/crawl-state.json`） |
| `pnpm accounts` | 账号分档（优质 / 普通 / 低质）和移出建议 |
| `pnpm follows:sync --dry-run` | 看 X 关注列表里有哪些账号还没加进名单 |
| `pnpm resend` / `pnpm subscribers` | 推送历史 / 订阅者 |

## 常见问题

| 现象 | 处理 |
|---|---|
| 连不上 x.com | `daily-auto.sh` 自动连接 WireGuard，仍不通每 15 分钟重试，到 10 点仍不通发提醒并用已有内容发送。网络恢复后可以手动运行 `scripts/daily-auto.sh` 补采 |
| 采集中途断网（退出码 5 / PAUSE） | 网络恢复后重新运行，从断点接着采 |
| 断网却被记成异常、进入冷却 | `pnpm crawl:resume` 解除冷却、从出错的那一步接着采，再重新运行每日任务 |
| 额度用完暂停（退出码 6） | 不冷却；看 `calls.jsonl` 是哪个接口，额度恢复后手动运行 `scripts/daily-auto.sh` 补采 |
| 限流、验证码 | 自动停止并冷却（24 / 48 小时），已采到的内容照常发送。不要重试或绕过，冷却结束后自动恢复 |
| 登录失效 | `pnpm crawl:chrome`，在采集专用的 Chrome 里重新登录采集用的 X 账号，然后 `pnpm crawl:reset` |
| 账号不存在、改名、被冻结 | 提醒里会列出来，改 `config/topics.yaml` |
| `pnpm plan` 退出码 3 | 冷却期或不在允许时段，今天不采集；`pnpm crawl:status` 看原因 |
| `scripts/daily.sh` 退出码 4 | 清单还没采完；`daily-auto.sh` 会自动接着采一次，Agent 版让 Agent 继续 `pnpm crawl next` |
| `scripts/daily.sh` 退出码 2 | 采集端遇到了限流或登录问题，已采到的内容照常处理 |
| AI 评审报 401 / 缺少密钥 | 检查 `.env` 的 `LLM_API_KEY`；系统环境变量里残留的旧 `DEEPSEEK_API_KEY` 不会覆盖它（launchd 的环境可以用 `launchctl unsetenv DEEPSEEK_API_KEY` 清掉）。评审失败的推文下次运行时自动重评 |
| 有订阅者发送失败 | 后台推送详情点"重试失败的"，或 `pnpm resend --date <日期> --failed` |
| 文章摘要失败 | 邮件里只显示标题和简介，不影响发送；还没生成概要的文章下次运行时重试 |
| 网站打不开 | `curl -I http://127.0.0.1:3000/` 看本机是否正常，再看 `data/logs/web.log` 和 Cloudflare Tunnel，见 [上线部署](deployment.md) |

排查时不要运行会打印其他进程环境变量的命令（如 `ps eww`、`pgrep -fl`），会把无关的密钥打到终端；需要时用 `pgrep -x` 或 `ps -o pid,comm`。

## 根据反馈调整精选

反馈不直接参与选稿，由人定期汇总后改规则：

1. 每隔几天运行 `pnpm feedback --summary`（默认最近 7 天，或 `--days 14`、`--from 2026-10-20 --to 2026-10-26`）。
   它列出每条踩的账号、主题、类别、分数、AI 当时的判断理由、你选的原因和说明，以及按账号 / 主题 / 类别 / 原因的计数。
2. 共性问题（某类内容总被踩）写进 [`config/curation.md`](../../config/curation.md) 的剔除类型或判断原则。
3. 某个账号整体偏弱时，在 `config/digest.yaml` 的 `account_weight` 里降权（如 `0.6`），并注明原因和日期；完全不想看就从 `topics.yaml` 移出。
4. `pnpm pipeline:dry --rereview` 按新标准重评，对照精选报告确认效果。

## 账号维护

- 精选报告末尾和 `pnpm accounts` 会建议移出长期低质的账号（样本 ≥ 20 条且保留率 < 5%），由你决定是否从 `topics.yaml` 删除。分档、建议移出和降权的完整机制见 [账号内容质量管理](../features/accounts.md#账号内容质量管理)。
- 新增、移出账号和调整权重可以在后台 [账号管理](../features/web-admin.md#账号管理adminaccounts)（`/admin/accounts`）里做，也可以直接改 `topics.yaml`、`digest.yaml`；新账号下次生成采集清单时自动排进去。
- 后台改的是 Mac mini 上的 `config/` 文件，git 里会显示为本地修改。拉取代码前先提交这些改动（或 `git stash`，拉完再 `git stash pop`），以免和仓库里的改动冲突。
- 采集账号（主号 / 小号）换成另一个时：在采集专用的 Chrome 里退出并登录新账号，手动操作和采集至少隔开 60 分钟。

## 代码更新后

- 流水线和采集：下次运行自动生效。
- 网站：`pnpm build && launchctl kickstart -k gui/$(id -u)/com.xrss.web`。
- 改了表结构：`pnpm db:migrate`。
- 想换订阅页的邮件示例：`pnpm preview:snapshot`。
