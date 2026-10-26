#!/usr/bin/env bash
# 不依赖 AI Agent 的每日任务：网络自检 → 生成采集清单 → 脚本采集（pnpm crawl:auto）→ 精选并发送（scripts/daily.sh）。
# 由 launchd 每天定时调用（见 agents/com.xrss.auto.plist），也可以手动运行。
#
# - 连不上 X（WireGuard 没连上）：先尝试连接，不通就每 15 分钟重试，到 XRSS_DEADLINE_HOUR 点（默认 10 点）仍不通就发提醒，
#   这时仍会运行 daily.sh，用已经采到的内容照常发送
# - 采集中途断网：等网络恢复后从断点接着采
# - 采集遇到限流、验证码、登录失效：停止采集，已采到的内容照常发送，并给管理员发提醒（.env 的 ADMIN_EMAIL）
# 日志：data/logs/auto-<日期>.log
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

DEADLINE_HOUR="${XRSS_DEADLINE_HOUR:-10}"
RETRY_SEC="${XRSS_NET_RETRY_SEC:-900}"
TODAY="$(TZ=Asia/Shanghai date +%F)"
mkdir -p data/logs
LOG="data/logs/auto-$TODAY.log"

hour() { TZ=Asia/Shanghai date +%-H; }
say() { echo "[$(TZ=Asia/Shanghai date '+%F %T')] $*"; }

# 等到能访问 X；到截止时间仍不通时返回 1
wait_network() {
  until scripts/net-check.sh; do
    if [ "$(hour)" -ge "$DEADLINE_HOUR" ]; then
      say "到 ${DEADLINE_HOUR} 点仍然访问不了 x.com，放弃今天的采集"
      pnpm -s notify "$TODAY 连不上 X，今天没有采集" "到 ${DEADLINE_HOUR} 点仍然访问不了 x.com（WireGuard 没有连上？）。今天会用已经采到的内容照常发送。网络恢复后可以手动运行 scripts/daily-auto.sh 补采。"
      return 1
    fi
    say "$((RETRY_SEC / 60)) 分钟后重试"
    sleep "$RETRY_SEC"
  done
}

crawl() {
  local code
  while :; do
    pnpm -s crawl:auto
    code=$?
    if [ "$code" -eq 5 ]; then
      say "采集中途断网，等网络恢复后接着采"
      wait_network || return 0
      continue
    fi
    [ "$code" -eq 0 ] || say "采集结束（退出码 $code）"
    return 0
  done
}

main() {
  say "===== 每日任务开始 ====="
  if wait_network; then
    pnpm -s plan
    local plan=$?
    if [ "$plan" -eq 0 ]; then
      crawl
    else
      say "今天不采集（pnpm plan 退出码 $plan），直接处理已有内容"
    fi
  fi

  scripts/daily.sh
  local code=$?
  if [ "$code" -eq 4 ]; then
    # 清单还没采完（比如采集进程被意外中断）：再接着采一次
    say "采集清单还没采完，继续采集"
    crawl
    scripts/daily.sh
    code=$?
  fi
  say "===== 每日任务结束（退出码 $code） ====="
  return "$code"
}

main 2>&1 | tee -a "$LOG"
exit "${PIPESTATUS[0]}"
