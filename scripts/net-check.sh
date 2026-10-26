#!/usr/bin/env bash
# 检查本机能不能访问 X。不通时尝试连接 WireGuard，再检查一次。
#   scripts/net-check.sh        退出码 0 = 能访问；1 = 仍然不通
#
# WireGuard 用 macOS 自带的 scutil 连接（WireGuard App 里的隧道会登记成系统 VPN）：
#   - .env 里设置 WG_TUNNEL=隧道名（WireGuard App 左侧列表里的名字）；不设置时自动用第一个 WireGuard 隧道
#   - 更省心的做法：在 WireGuard App 里给隧道打开"按需连接（On-Demand）"，系统会一直保持连接
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${WG_TUNNEL:-}" ] && [ -f "$ROOT/.env" ]; then
  WG_TUNNEL="$(sed -n 's/^[[:space:]]*WG_TUNNEL[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" | tail -1 | sed 's/^["'\'']//; s/["'\'']$//')"
fi

reachable() {
  local code
  code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' https://x.com/robots.txt 2>/dev/null)"
  [[ "$code" =~ ^[23] ]]
}

if reachable; then
  echo "网络正常：可以访问 x.com"
  exit 0
fi
echo "访问不了 x.com，尝试连接 WireGuard"

if command -v scutil >/dev/null 2>&1; then
  tunnel="${WG_TUNNEL:-}"
  if [ -z "$tunnel" ]; then
    # scutil --nc list 的行形如：* (Disconnected)  XXXX VPN (com.wireguard.macos) "隧道名"  [VPN/com.wireguard.macos]
    tunnel="$(scutil --nc list | grep -i wireguard | head -1 | sed -n 's/.*"\(.*\)".*/\1/p')"
  fi
  if [ -n "$tunnel" ]; then
    scutil --nc start "$tunnel" && echo "已请求连接 WireGuard 隧道：$tunnel"
  else
    echo "没有找到 WireGuard 隧道（scutil --nc list 里没有），请在 .env 里设置 WG_TUNNEL"
  fi
fi

# 最多等 2 分钟
for _ in $(seq 1 12); do
  sleep 10
  if reachable; then
    echo "网络已恢复：可以访问 x.com"
    exit 0
  fi
done
echo "WireGuard 连接后仍然访问不了 x.com"
exit 1
