# 精选晨报（twitter-rss）

> 每天早上一封邮件，读完 AI 圈 100 位一线建设者昨天在 X（原 Twitter）上说了什么。

信息太多，值得读的太少。与其刷几百条推文，不如关注真正在做事的人：发布模型的实验室、写代码的研究者、做产品的开发者，
只看他们昨天分享的新东西、真实经验和有见地的判断。

精选晨报每天替你看一遍：由你的 AI Agent（Claude Code、Codex、DeepSeek Harness 等）在浏览器里采集博主前一天的推文，
大模型按你写下的标准逐条精选、翻译、摘要，按主题整理成一封邮件发给订阅者，同时提供 RSS。

## 你会收到什么

每天早上一封按主题分区的邮件，默认最多 30 条，按评分排序：

- **完整的推文**：长文全文、作者的连续推文（Thread）合并、引用推文、图片，不用跳转 X 也能读完
- **中文翻译**：可选中文或原文阅读
- **AI 摘要和要点**：较长的引用推文、外部文章（如官方技术博客）附中文概要和 3–5 条要点
- **评分和类型**：最佳实践、真实问题、新发布、应用案例、行业趋势、专家思考
- **主题标签页**：苹果邮件、163 等可以点标签切换主题；不支持的邮箱自动按主题依次排列
- **订阅页和 RSS**：订阅者自己选主题和语言，每个主题都有 RSS 地址（`/feed/<主题>.zh.xml`）

## 快速开始

需要 Node.js 22+、pnpm，以及 macOS 或 Linux 上已登录 X 的 Chrome（建议用专用账号）。

```bash
git clone <仓库地址> twitter-rss && cd twitter-rss
pnpm install
cp .env.example .env     # 填大模型 API Key、QQ 邮箱 SMTP 授权码等，可以先留空试跑
pnpm db:migrate          # 建表
pnpm email:preview       # 用示例数据渲染邮件 → data/out/preview-zh.html
pnpm dev                 # 订阅页 http://localhost:3000
```

然后在项目目录里让你的 Agent 跑一次每日任务，例如：

```bash
scripts/agent-run.sh claude      # 或 codex
```

第一次运行前要装好 Tencent Browser Skill（`bsk`），见 [agents/README.md](agents/README.md)。没配 SMTP 时邮件不会真的发出，确认链接会打印在终端。

## 让 Agent 每天自动跑

采集需要一个能运行命令、能操作浏览器的 Agent。每日任务写在 [`agents/daily-task.md`](agents/daily-task.md)，各种 Agent 用的都是同一份：
生成采集清单 → 逐步采集（脚本决定账号、顺序和等待时间，Agent 只照做）→ 解析入库 → AI 精选 → 发信。

| Agent | 怎么接入 |
|---|---|
| **Claude Code** | `scripts/agent-run.sh claude`（`claude -p` 无人值守运行），项目根目录的 `CLAUDE.md` 会自动加载项目规则 |
| **Codex** | `scripts/agent-run.sh codex`（`codex exec`），自动读取 `AGENTS.md` |
| **DeepSeek Harness** | 新建每天 06:30 的定时任务，把 `agents/daily-task.md` 里的提示词整段粘贴进去 |
| **其他 Agent** | 能运行 shell 命令就行：在项目目录执行那段提示词 |

定时：macOS 用 [`agents/com.xrss.daily.plist`](agents/com.xrss.daily.plist)（launchd，睡眠唤醒后会补跑），Linux 用 cron：

```
30 6 * * * cd /path/to/twitter-rss && scripts/agent-run.sh claude
```

一次完整采集通常要 30–60 分钟，这是有意放慢的节奏。日志在 `data/logs/`，安装细节和常见问题见 [agents/README.md](agents/README.md)。

### 不用 Agent：脚本版

`pnpm crawl:auto` 用脚本连接一个采集专用的 Chrome（独立资料，只登录小号）完成采集，规则和清单与 Agent 版相同，并能保存完整的网络响应（长推文全文）。
`scripts/daily-auto.sh` 把网络自检（WireGuard）、采集、精选和发送串起来，由 launchd 每天定时运行。详见 [agents/script-mode.md](agents/script-mode.md)。

## 修改设置

所有设置都是 `config/` 下的纯文本文件，改完下次运行生效：

| 文件 | 管什么 |
|---|---|
| `config/topics.yaml` | 主题和博主（只采集这里列出的账号），主题名、颜色、说明 |
| `config/digest.yaml` | 每封邮件的条数、最低分、视频降权、邮件大小上限、标签页、合并发送 |
| `config/crawl.yaml` | 采集节流：每天账号数（默认 50）、节奏、活跃时段、异常后的冷却期 |
| `config/curation.md` | 精选标准，原样放进给大模型的提示词 |
| `.env` | 大模型接口、SMTP、数据库地址、网站地址、管理后台密码 |

大模型默认用 DeepSeek（`deepseek-flash`）。同时支持 Anthropic 和 OpenAI 两种接口格式：在 `.env` 里设置 `LLM_API`（`anthropic` / `openai`）、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`，就能换成 Claude、GPT、Kimi、通义千问、智谱 GLM 或本地 Ollama 等，每次运行的日志会写出实际使用的模型和端点。

## 调整精选口味

精选标准就是 [`config/curation.md`](config/curation.md) 这份中文说明，直接改它：想多看什么、少看什么、读者是谁。

默认的读者定位是有一定技术背景的产品、研发和 AI 爱好者：说教、显而易见、纯搬运、推广的内容剔除，有具体信息、对他们有启发的保留。
评分是 5 分制（5 必读、4 值得读、3 有收获），默认 3 分以上通过。

改完后运行 `pnpm pipeline:dry --rereview`，让已评审的推文按新标准重评，对照 `data/out/<日期>/curation.md` 里每条的分数和理由。

## 默认博主

来自司徒K《2026 年 X 上最值得关注的 100 个 AI 博主》，合并为 5 个主题。每天按账号质量和上次采集时间轮流采集其中 50 个，
没轮到的账号下次补收错过的日子。

### 实验室与官方发布（26）

[@sama](https://x.com/sama), [@demishassabis](https://x.com/demishassabis), [@gdb](https://x.com/gdb), [@mustafasuleyman](https://x.com/mustafasuleyman), [@sundarpichai](https://x.com/sundarpichai), [@DarioAmodei](https://x.com/DarioAmodei), [@elonmusk](https://x.com/elonmusk), [@OpenAI](https://x.com/OpenAI), [@AnthropicAI](https://x.com/AnthropicAI), [@GoogleDeepMind](https://x.com/GoogleDeepMind), [@deepseek_ai](https://x.com/deepseek_ai), [@AIatMeta](https://x.com/AIatMeta), [@huggingface](https://x.com/huggingface), [@Kimi_Moonshot](https://x.com/Kimi_Moonshot), [@Alibaba_Qwen](https://x.com/Alibaba_Qwen), [@MistralAI](https://x.com/MistralAI), [@Zai_org](https://x.com/Zai_org), [@MiniMax_AI](https://x.com/MiniMax_AI), [@thsottiaux](https://x.com/thsottiaux), [@claudeai](https://x.com/claudeai), [@GeminiApp](https://x.com/GeminiApp), [@OpenAIDevs](https://x.com/OpenAIDevs), [@perplexity_ai](https://x.com/perplexity_ai), [@OfficialLoganK](https://x.com/OfficialLoganK), [@alexalbert__](https://x.com/alexalbert__), [@_catwu](https://x.com/_catwu)

### 研究者与深度观点（15）

[@karpathy](https://x.com/karpathy), [@ylecun](https://x.com/ylecun), [@AndrewYNg](https://x.com/AndrewYNg), [@drfeifei](https://x.com/drfeifei), [@fchollet](https://x.com/fchollet), [@DrJimFan](https://x.com/DrJimFan), [@JeffDean](https://x.com/JeffDean), [@rasbt](https://x.com/rasbt), [@hardmaru](https://x.com/hardmaru), [@lilianweng](https://x.com/lilianweng), [@OriolVinyalsML](https://x.com/OriolVinyalsML), [@_jasonwei](https://x.com/_jasonwei), [@Thom_Wolf](https://x.com/Thom_Wolf), [@natolambert](https://x.com/natolambert), [@jackclarkSF](https://x.com/jackclarkSF)

### AI 编程、Agent 与开源（11）

[@rauchg](https://x.com/rauchg), [@bcherny](https://x.com/bcherny), [@steipete](https://x.com/steipete), [@cursor_ai](https://x.com/cursor_ai), [@amasad](https://x.com/amasad), [@simonw](https://x.com/simonw), [@mckaywrigley](https://x.com/mckaywrigley), [@LangChain](https://x.com/LangChain), [@ClementDelangue](https://x.com/ClementDelangue), [@NousResearch](https://x.com/NousResearch), [@ollama](https://x.com/ollama)

### 中文圈｜行业解读与产品出海（26）

[@situking](https://x.com/situking), [@AYi_AInotes](https://x.com/AYi_AInotes), [@jinchenma_ai](https://x.com/jinchenma_ai), [@oran_ge](https://x.com/oran_ge), [@lifesinger](https://x.com/lifesinger), [@yiren_ai](https://x.com/yiren_ai), [@yangyi](https://x.com/yangyi), [@vista8](https://x.com/vista8), [@howie_serious](https://x.com/howie_serious), [@gkxspace](https://x.com/gkxspace), [@servasyy_ai](https://x.com/servasyy_ai), [@cellinlab](https://x.com/cellinlab), [@Astronaut_1216](https://x.com/Astronaut_1216), [@yhslgg](https://x.com/yhslgg), [@yucheng](https://x.com/yucheng), [@hezhiyan7](https://x.com/hezhiyan7), [@dotey](https://x.com/dotey), [@Francis_YAO_](https://x.com/Francis_YAO_), [@turingbook](https://x.com/turingbook), [@shao__meng](https://x.com/shao__meng), [@Svwang1](https://x.com/Svwang1), [@xiaohu](https://x.com/xiaohu), [@aigclink](https://x.com/aigclink), [@Gorden_Sun](https://x.com/Gorden_Sun), [@frxiaobei](https://x.com/frxiaobei), [@MinLiBuilds](https://x.com/MinLiBuilds)

### 中文圈｜开发实践与内容创作（22）

[@AlchainHust](https://x.com/AlchainHust), [@Jason_Young1231](https://x.com/Jason_Young1231), [@GitHub_Daily](https://x.com/GitHub_Daily), [@lxfater](https://x.com/lxfater), [@HiTw93](https://x.com/HiTw93), [@geekbb](https://x.com/geekbb), [@karminski3](https://x.com/karminski3), [@yetone](https://x.com/yetone), [@yihong0618](https://x.com/yihong0618), [@Barret_China](https://x.com/Barret_China), [@Pluvio9yte](https://x.com/Pluvio9yte), [@gengdaJ](https://x.com/gengdaJ), [@li9292](https://x.com/li9292), [@cnyzgkc](https://x.com/cnyzgkc), [@op7418](https://x.com/op7418), [@Saccc_c](https://x.com/Saccc_c), [@ZHO_ZHO_ZHO](https://x.com/ZHO_ZHO_ZHO), [@huangyun_122](https://x.com/huangyun_122), [@lijigang](https://x.com/lijigang), [@liyue_ai](https://x.com/liyue_ai), [@berryxia](https://x.com/berryxia), [@dingyi](https://x.com/dingyi)

## 工作原理

1. **生成清单**：`pnpm plan` 按账号质量（近 14 天的通过率）和上次采集时间挑出今天要采的账号
2. **逐步采集**：Agent 循环运行 `pnpm crawl next` 领取下一步，在浏览器里打开主页、读取推文，做完用 `pnpm crawl done` 报告；脚本检查结果、控制间隔，中断后从断点继续
3. **入库**：解析、去重、合并 Thread 和长文全文
4. **规则粗筛**：去掉回复、纯转发、过短内容；按互动相对作者自己中位数打规则分
5. **AI 初审**：逐条判断类型和质量分，同时翻译、写摘要（图片和视频不做识别）
6. **编辑终审**：整批去掉重复事件、相同观点和最近几天发过的内容
7. **发信**：按每位订阅者的主题和语言挑选，相同组合合并成一封（密送）发送，并更新 RSS

## 管理

在 `.env` 设置 `ADMIN_PASSWORD` 后可以打开管理页（没设置时不开放）：

- `/admin/subscribers`：订阅者、邮箱、状态、主题、订阅时间、累计收到封数，可导出 CSV
- `/admin/deliveries`：每一期的推送结果，查看发出的邮件，重试失败的、补发给未收到的、给某人重新发送

命令行：`pnpm subscribers`、`pnpm resend`、`pnpm crawl progress`、`pnpm email:test --to 邮箱`。

## 环境要求

- Node.js 22+、pnpm
- 一个能运行命令的 AI Agent：Claude Code、Codex、DeepSeek Harness 等
- [Tencent Browser Skill](https://github.com/Tencent/BrowserSkill) 和已登录 X 的 Chrome（建议专用账号）
- 大模型 API Key：默认 DeepSeek，可换成任何兼容 Anthropic 或 OpenAI 接口、支持工具调用的服务
- 发信邮箱：默认 QQ 邮箱 SMTP（需要授权码）
- 上线时：Turso 数据库 + 可部署 Next.js 的平台（如 Vercel）

## 隐私与安全

- **只读浏览**：Agent 只打开清单里的主页和推文，不点赞、不转发、不关注、不回复、不发帖
- **慢、少、遇到问题就停**：每天限量、按人的节奏浏览；遇到限流、验证码、登录失效立即停止并进入冷却期，不重试、不绕过
- **不对抗检测**：不改浏览器指纹、不换 IP 或代理、不轮换多个账号、不处理验证码
- **数据留在你这里**：推文和订阅者存在你自己的数据库；送给大模型的只有公开推文内容，订阅者邮箱不会发给大模型
- 请遵守 X 的服务条款，只用于个人或小范围阅读

## 更多

完整说明（目录结构、采集节流、选稿算法、邮件版式、合并发送、部署上线、常用命令）见 [docs/guide.md](docs/guide.md)。
