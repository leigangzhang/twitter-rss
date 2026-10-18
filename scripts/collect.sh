#!/usr/bin/env bash
# 采集：用 Claude Code（底层模型换成 DeepSeek deepseek-flash）+ Browser Skill，按 AGENT_PROMPT.md 采集 X。
# 前提：本机已安装 Claude Code（claude 命令）和 Browser Skill（bsk install-skill），Chrome 已登录采集用的 X 账号。
# 用法：scripts/collect.sh            （daily.sh 默认会调用它）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "缺少 DEEPSEEK_API_KEY，无法启动采集 Agent" >&2
  exit 1
fi

MODEL="${LLM_MODEL:-deepseek-flash}"

# 让 Claude Code 通过 DeepSeek 的 Anthropic 兼容接口运行，所有请求都使用 deepseek-flash
# 参考：https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
export ANTHROPIC_BASE_URL="${LLM_BASE_URL:-https://api.deepseek.com/anthropic}"
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
unset ANTHROPIC_API_KEY
export ANTHROPIC_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL"
export CLAUDE_CODE_SUBAGENT_MODEL="$MODEL"

TODAY="$(TZ="${TZ_NAME:-Asia/Shanghai}" date +%F)"
PROMPT="今天是 ${TODAY}，项目根目录是 ${ROOT}。采集清单在 data/inbox/${TODAY}/plan.json。
请使用 browser-skill 技能，严格按下面的任务说明执行，完成后简要汇报每个账号的采集条数和补抓情况。

$(cat packages/collector/AGENT_PROMPT.md)"

claude -p "$PROMPT" --model "$MODEL" --permission-mode acceptEdits
