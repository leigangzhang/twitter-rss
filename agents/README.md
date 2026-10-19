# 用 Agent 每天自动运行

每天的流程是：生成采集清单 → Agent 操作浏览器逐个采集 → AI 精选并发邮件。
只有"操作浏览器"这一步需要 Agent，其余都是项目里的脚本，所以任何**能运行 shell 命令、又能操作浏览器**的 Agent 都可以接入。

交给 Agent 的提示词只有一份：[`daily-task.md`](daily-task.md)。下面是各 Agent 的接入方式。

## 1. 准备浏览器（所有 Agent 通用）

推荐 [Tencent Browser Skill](https://github.com/Tencent/BrowserSkill)：它操作的是你本机已经登录 X 的 Chrome，提供 `bsk` 命令，任何能运行 shell 的 Agent 都能用。

```bash
curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh
bsk install-skill        # 选择你用的 Agent（bsk install-skill --list 查看支持哪些）
bsk doctor               # 确认浏览器扩展已连接
```

然后在 Chrome 里登录**采集专用的 X 小号**。也可以用 Agent 自带的浏览器工具（如 Claude in Chrome），只要能打开页面、读取页面内容即可。

## 2. 选一个 Agent

### Claude Code

```bash
scripts/agent-run.sh claude        # 手动跑一次，确认整个流程正常
```

脚本以无人值守方式调用 `claude -p`，只开放读写文件和运行命令的权限。项目根目录的 `CLAUDE.md` 会告诉它这个项目的规则。

### Codex

```bash
scripts/agent-run.sh codex
```

脚本调用 `codex exec`。采集要访问本机的 Browser Skill 守护进程（`~/.bsk`），精选要访问 DeepSeek 接口，所以用的是不限制沙箱的模式；只在你信任的本机项目里这样运行。项目根目录的 `AGENTS.md` 会告诉它这个项目的规则。

### DeepSeek Harness

在 desktop 或 web profile 里启用 Browser Skill，模型选 `deepseek-flash`，新建一个定时任务：每天 06:30，工作目录选这个项目，提示词粘贴 [`daily-task.md`](daily-task.md) 里的整段内容。

### 其他 Agent

把 `daily-task.md` 的提示词交给它即可，或者在 `scripts/agent-run.sh` 里照着 claude / codex 的写法加一行。要求只有两个：能在项目目录运行 shell 命令；能操作一个已登录 X 的浏览器。

## 3. 每天定时运行

自带定时任务的 Agent（如 DeepSeek Harness）直接在它里面设置。命令行 Agent 用系统定时任务调用 `scripts/agent-run.sh`：

**macOS（launchd，推荐）**：编辑 [`com.xrss.daily.plist`](com.xrss.daily.plist) 里的项目路径和 Agent 名，然后

```bash
cp agents/com.xrss.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.xrss.daily.plist
```

**Linux（cron）**：`crontab -e` 加一行

```
30 6 * * * cd /path/to/twitter-rss && scripts/agent-run.sh claude
```

定时时间建议 06:30：脚本会再随机等待 0–20 分钟才开始，加上 30–60 分钟的采集，再加上精选和发信，邮件大约 7:10–8:00 发出。
Agent 的输出写在 `data/logs/agent-<日期>-<agent>.log`，流水线日志在 `data/logs/<日期>.log`。

## 运行中的常见情况

| 现象 | 处理 |
|---|---|
| Agent 中途停了 | 再运行一次即可，`pnpm crawl next` 会从断点继续 |
| `pnpm plan` 退出码 3 | 冷却期或不在允许时段，今天不采集；`pnpm crawl:status` 看原因 |
| 登录失效 | 在 Chrome 里重新登录 X，然后 `pnpm crawl:reset` |
| `scripts/daily.sh` 退出码 4 | 清单还没采完，让 Agent 继续 `pnpm crawl next` |
