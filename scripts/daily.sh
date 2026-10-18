#!/usr/bin/env bash
# 采集完成后的处理：解析原始响应 → 入库 → AI 精选（初审 + 终审）→ 发送邮件，并写日志。
# 由 DeepSeek Harness 的每日定时任务在采集结束后调用（见 deepseek-harness/daily-task.md），也可以手动运行。
#   scripts/daily.sh            正式运行
#   scripts/daily.sh --dry-run  试跑，不发邮件
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 定时任务的环境变量可能很少，补上常见的 Node 路径
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(TZ=Asia/Shanghai date +%F).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== $(date '+%F %T') 开始处理 ====="

TODAY="$(TZ=Asia/Shanghai date +%F)"
# 采集端保存的原始响应统一再解析一次（已解析过也没关系），确保详情页补抓的全文被合并
if [ -d "data/inbox/$TODAY/raw" ]; then
  pnpm -s --filter @xrss/collector parse
fi

status=0
pnpm -s pipeline "$@" || status=$?

echo "===== $(date '+%F %T') 结束（退出码 $status） ====="
exit "$status"
