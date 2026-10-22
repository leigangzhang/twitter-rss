#!/bin/bash
# 双击启动本地服务（订阅页、管理页、RSS）：http://localhost:3000
# 关闭这个终端窗口，或按 Ctrl+C，服务就会停止。
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null; fi
echo "启动本地服务：http://localhost:3000（关闭这个窗口即停止）"
echo
pnpm dev
