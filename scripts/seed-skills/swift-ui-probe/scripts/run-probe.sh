#!/usr/bin/env bash
# 编译并运行 Swift 界面探针；模块缓存与产物都放在 --out 目录，避免写 ~/Library 被沙箱拒绝。
#
#   run-probe.sh --mode focus --context list|search|body|compose|settings [--title NAME] [--out DIR]
#   run-probe.sh --mode scene [--title NAME] [--out DIR]
#
# 输出：<out>/ui-focus-<context>.txt 或 <out>/scene-phase.txt；编译产物同目录。
set -euo pipefail

MODE=""
CONTEXT="list"
TITLE="probe"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --context) CONTEXT="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "用法：run-probe.sh --mode focus|scene [--context list|search|body|compose|settings] [--title NAME] [--out DIR]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$PWD/evidence}"
mkdir -p "$OUT"
CACHE="$OUT/.probe-cache"
mkdir -p "$CACHE"
export CLANG_MODULE_CACHE_PATH="$CACHE"

case "$MODE" in
  focus)
    case "$CONTEXT" in
      list|search|body|compose|settings) ;;
      *) echo "未知 context：$CONTEXT" >&2; exit 2 ;;
    esac
    SRC="$SCRIPT_DIR/focus-delete-probe.swift"
    BIN="$OUT/focus-delete-probe"
    LOG="$OUT/ui-focus-$CONTEXT.txt"
    swiftc -O -module-cache-path "$CACHE" -Xcc "-fmodules-cache-path=$CACHE" -o "$BIN" "$SRC"
    "$BIN" --focus "$CONTEXT" --title "$TITLE" --log "$LOG"
    echo "已写入：$LOG"
    ;;
  scene)
    SRC="$SCRIPT_DIR/scene-phase-probe.swift"
    BIN="$OUT/scene-phase-probe"
    LOG="$OUT/scene-phase.txt"
    swiftc -O -parse-as-library -module-cache-path "$CACHE" -Xcc "-fmodules-cache-path=$CACHE" -o "$BIN" "$SRC"
    "$BIN" --title "$TITLE" > "$LOG" 2>&1
    echo "已写入：$LOG"
    ;;
  *)
    echo "未知 mode：$MODE" >&2
    exit 2
    ;;
esac
