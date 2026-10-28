#!/usr/bin/env bash
# 不依赖 AI Agent 的每日任务：网络自检 → 同步关注（打开时）→ 生成采集清单 → 脚本采集（pnpm crawl:auto）→ 精选并发送（scripts/daily.sh）。
# 由 launchd 每天定时调用（见 agents/com.xrss.auto.plist），也可以手动运行。
#
# - 连不上 X（WireGuard 没连上）：先尝试连接，不通就每 15 分钟重试，到 XRSS_DEADLINE_HOUR 点（默认 10 点）仍不通就发提醒，
#   这时仍会运行 daily.sh，用已经采到的内容照常发送
# - 采集中途断网：等网络恢复后从断点接着采
# - 采集遇到限流、验证码、登录失效：停止采集，已采到的内容照常发送，并给管理员发提醒（.env 的 ADMIN_EMAIL）
# - X 给的额度用完、要等很久才恢复（crawl:auto 退出码 6）：暂停采集，已采到的内容照常发送，并给管理员发提醒
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

# 最近一次 crawl:auto 的退出码
CRAWL_CODE=0

crawl() {
  local code
  while :; do
    pnpm -s crawl:auto
    code=$?
    CRAWL_CODE=$code
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
    # 按 crawl.yaml 的 follow_sync 同步关注列表（没打开或没到间隔时直接跳过）；遇到限制会进入冷却，下面的 plan 就不会安排采集
    pnpm -s follows:sync --if-due
    pnpm -s plan
    local plan=$?
    if [ "$plan" -eq 0 ]; then
      crawl
    else
      say "今天不采集（pnpm plan 退出码 $plan），直接处理已有内容"
    fi
  fi

  if [ "$CRAWL_CODE" -eq 6 ]; then
    say "采集因额度用完暂停，用已经采到的内容照常处理"
    pnpm -s notify "$TODAY 采集因额度用完暂停" "X 返回的接口额度不够，采集已暂停（不算异常、不冷却），今天用已经采到的内容照常发送。哪个接口额度不够见 data/inbox/$TODAY/calls.jsonl；额度恢复后可以手动运行 scripts/daily-auto.sh 补采。"
    XRSS_ALLOW_PARTIAL=1 scripts/daily.sh
    local partial=$?
    say "===== 每日任务结束（退出码 $partial） ====="
    return "$partial"
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
