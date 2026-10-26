#!/usr/bin/env bash
# 采集完成后的处理：解析原始响应 → 入库 → AI 精选（初审 + 终审）→ 发送邮件，并写日志。
# 由 Agent 的每日任务在采集结束后调用（见 agents/daily-task.md），也可以手动运行。
#   scripts/daily.sh            正式运行
#   scripts/daily.sh --dry-run  试跑，不发邮件
#   XRSS_ALLOW_PARTIAL=1 scripts/daily.sh   采集清单没采完也照常处理（采集因额度用完暂停时由 daily-auto.sh 使用）
#
# 退出码：0 正常；2 采集端遇到限流 / 登录失效等；4 今天的采集清单还没采完（不发送，继续 pnpm crawl next）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 定时任务的环境变量可能很少，补上常见的 Node 路径
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"
TODAY="$(TZ=Asia/Shanghai date +%F)"
LOG="$LOG_DIR/$TODAY.log"

main() {
  echo "===== $(date '+%F %T') 开始处理 ====="

  # 采集清单没采完时不发送：没采的账号明天也会补收，但今天应该先把清单采完
  if ! pnpm -s crawl progress; then
    if [ "${XRSS_ALLOW_PARTIAL:-}" = "1" ]; then
      echo "今天的采集没有采完（额度用完暂停），用已经采到的内容照常处理"
    else
      echo "今天的采集还没完成，不发送。请继续运行 pnpm crawl next，直到出现 FINISHED 再运行本脚本。"
      echo "===== $(date '+%F %T') 结束（退出码 4） ====="
      return 4
    fi
  fi

  # 采集端保存的原始响应统一再解析一次（已解析过也没关系），确保详情页补抓的全文被合并
  if [ -d "data/inbox/$TODAY/raw" ]; then
    pnpm -s --filter @xrss/collector parse || return 1
  fi

  local status=0
  pnpm -s pipeline "$@" || status=$?

  echo "===== $(date '+%F %T') 结束（退出码 ${status}） ====="
  return "$status"
}

# 不用 exec > >(tee …)：有些 Agent 的 shell 不支持 /dev/fd
main "$@" 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
