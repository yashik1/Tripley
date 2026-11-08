#!/usr/bin/env bash
# Start a throwaway local Postgres 16 and load the Supabase stub + migrations.
# Used by the database tests (tests/db). Requires the postgresql-16 server binaries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${TRIPLEY_PG_DIR:-/tmp/tripley-pgtest}"
PORT="${TRIPLEY_PG_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

case "${1:-start}" in
  start)
    if [ ! -d "$BASE/data" ]; then
      mkdir -p "$BASE"
      [ "$(id -u)" = "0" ] && chown postgres "$BASE"
      "${RUN_AS[@]}" "$PGBIN/initdb" -D "$BASE/data" -A trust -U postgres >/dev/null
    fi
    if ! "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$BASE/data" status >/dev/null 2>&1; then
      "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$BASE/data" -l "$BASE/log" -w \
        -o "-k $BASE -p $PORT -c listen_addresses=''" start >/dev/null
    fi
    psql() { command psql -h "$BASE" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
    psql -d postgres -c "drop database if exists tripley_test with (force)" -c "create database tripley_test"
    psql -d tripley_test -f "$ROOT/tests/db/supabase-stub.sql"
    for f in "$ROOT"/supabase/migrations/*.sql; do
      psql -d tripley_test -f "$f"
    done
    echo "postgresql://postgres@localhost:$PORT/tripley_test?host=$BASE"
    ;;
  stop)
    "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$BASE/data" -m fast stop >/dev/null || true
    ;;
esac
