#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="$ROOT/.local/pg/bin"
PG_DATA="$ROOT/.local/pgdata"
PG_PORT="${PG_PORT:-54329}"
PG_LOG="$PG_DATA/postgres.log"

is_running() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

case "${1:-}" in
  start)
    if is_running; then
      echo "PostgreSQL already running (port $PG_PORT, data $PG_DATA)"
      exit 0
    fi
    if [ ! -f "$PG_DATA/PG_VERSION" ]; then
      "$PG_BIN/initdb" -D "$PG_DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C
    fi
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" -o "-p $PG_PORT -h 127.0.0.1" -w start
    ;;
  stop)
    if ! is_running; then
      echo "PostgreSQL is not running"
      exit 0
    fi
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast -w stop
    ;;
  status)
    if is_running; then
      "$PG_BIN/pg_ctl" -D "$PG_DATA" status
    else
      echo "PostgreSQL is not running"
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
