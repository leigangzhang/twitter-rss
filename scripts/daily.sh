#!/usr/bin/env bash
# 每日任务：生成采集清单 → 调用 Browser Skill 采集 → 运行流水线发送邮件
# 由 launchd 定时调用（见 scripts/launchd/），也可以手动运行：scripts/daily.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# launchd 的环境变量很少，补上常见的 Node 路径
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

if [ -f .env ]; then set -a; . ./.env; set +a; fi

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%F).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== $(date '+%F %T') 开始 ====="

# 随机延迟 0–30 分钟，避免每天同一时刻准点访问 X
if [ "${NO_JITTER:-0}" != "1" ]; then
  delay=$(( RANDOM % 1800 ))
  echo "随机等待 ${delay}s"
  sleep "$delay"
fi

pnpm -s plan

# 采集：调用装有 Browser Skill 的 Agent，按 packages/collector/AGENT_PROMPT.md 执行。
# 在 .env 里设置 COLLECT_CMD，例如：
#   COLLECT_CMD='claude -p "$(cat packages/collector/AGENT_PROMPT.md)" --permission-mode acceptEdits'
if [ -n "${COLLECT_CMD:-}" ]; then
  echo "开始采集"
  bash -c "$COLLECT_CMD"
else
  echo "未设置 COLLECT_CMD，跳过采集，只处理 data/inbox 里已有的文件"
fi

pnpm -s pipeline

echo "===== $(date '+%F %T') 结束 ====="
