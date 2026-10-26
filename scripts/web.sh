#!/usr/bin/env bash
# 以生产模式运行网站（订阅页、偏好设置、退订、RSS、管理页），供 launchd 常驻（见 agents/com.xrss.web.plist）。
# 只监听本机 127.0.0.1，由 Cloudflare Tunnel 等反向代理对外提供访问。
# 没有构建产物时先构建一次；代码更新后运行 pnpm build，再 launchctl kickstart -k gui/$(id -u)/com.xrss.web 重启。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# launchd 的环境变量很少，补上常见的 Node 路径
export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi

PORT="${XRSS_WEB_PORT:-3000}"
if [ ! -f apps/web/.next/BUILD_ID ]; then
  pnpm build
fi
exec pnpm --filter @xrss/web exec next start -H 127.0.0.1 -p "$PORT"
