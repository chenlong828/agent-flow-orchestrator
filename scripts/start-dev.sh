#!/usr/bin/env bash
# 本机联调：在系统终端里托管 orchestrator。
#
# 用法：
#   ./scripts/start-dev.sh start
#   ./scripts/start-dev.sh status
#   ./scripts/start-dev.sh logs --follow
#   ./scripts/start-dev.sh reload
#   ./scripts/start-dev.sh stop
#   ./scripts/start-dev.sh restart
#
# 服务被 kill 后由监督进程自动拉起；运行文件在 .local/run 与 .local/logs。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

find_bun() {
  if [ -n "${BUN_BIN:-}" ] && [ -x "${BUN_BIN}" ]; then
    printf '%s' "${BUN_BIN}"
    return 0
  fi
  if [ -x "$repo_root/.local/bun/bun" ]; then
    printf '%s' "$repo_root/.local/bun/bun"
    return 0
  fi
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  for candidate in "${BUN_INSTALL:+${BUN_INSTALL}/bin/bun}" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! BUN_BIN_PATH="$(find_bun)"; then
  echo "找不到 bun：用 BUN_BIN=<bun 绝对路径> 指定，或把 bun 加入 PATH" >&2
  exit 1
fi

exec "$BUN_BIN_PATH" run scripts/start-bg.ts "$@"
