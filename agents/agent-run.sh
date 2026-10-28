#!/usr/bin/env bash
# 让命令行 Agent 无人值守地跑一次每日任务（手动运行，或交给 launchd / cron 定时调用）。
#   agents/agent-run.sh claude     用 Claude Code
#   agents/agent-run.sh codex      用 Codex
# 提示词来自 agents/daily-task.md（它会让 Agent 先读 agents/AGENTS.md 的规则），输出写到 data/logs/agent-<日期>-<agent>.log
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 定时任务的环境变量很少，补上常见的 Node / Agent 安装路径
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

AGENT="${1:-}"
PROMPT="$(awk '/^```text$/{f=1;next} /^```$/{if(f){exit}} f' agents/daily-task.md)"
if [ -z "$PROMPT" ]; then
  echo "没有从 agents/daily-task.md 读到提示词" >&2
  exit 1
fi

mkdir -p data/logs
LOG="data/logs/agent-$(TZ=Asia/Shanghai date +%F)-${AGENT:-unknown}.log"

run() {
  echo "===== $(date '+%F %T') $AGENT 开始 ====="
  case "$AGENT" in
    claude)
      # 无人值守：只开放读写文件和运行命令（采集要用 bsk、pnpm）
      claude -p "$PROMPT" --allowedTools "Bash Read Write Edit Glob Grep"
      ;;
    codex)
      # 采集要连本机 Browser Skill 守护进程（~/.bsk），精选要访问 DeepSeek 接口，沙箱需允许
      codex exec --sandbox danger-full-access "$PROMPT"
      ;;
    *)
      echo "用法：agents/agent-run.sh claude|codex（其他 Agent 见 docs/scheduling/agent-mode.md）" >&2
      return 64
      ;;
  esac
}

run 2>&1 | tee -a "$LOG"
status="${PIPESTATUS[0]}"
echo "===== $(date '+%F %T') $AGENT 结束（退出码 ${status}） =====" | tee -a "$LOG"
exit "$status"
