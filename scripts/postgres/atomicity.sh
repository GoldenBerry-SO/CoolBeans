#!/usr/bin/env bash
# ABOUTME: Runs the Postgres atomicity checks against a throwaway container (issue #32).
# ABOUTME: Contention is the point, so this needs a real Postgres, not a mock.
set -euo pipefail

cd "$(dirname "$0")/../.."

NAME=coolbeans-pg-atomicity
PORT=${PG_PORT:-55432}
export PG_URL="postgres://postgres:beans@localhost:${PORT}/coolbeans"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

printf '\n\033[1mPostgres on :%s\033[0m\n' "$PORT"
docker run -d --rm --name "$NAME" \
  -e POSTGRES_PASSWORD=beans -e POSTGRES_DB=coolbeans \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

# pg_isready reports the socket before the TCP listener is actually serving, which
# produced a "server closed the connection unexpectedly" on the first connect.
for _ in $(seq 1 60); do
  if psql "$PG_URL" -tAc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql "$PG_URL" -tAc 'select 1' >/dev/null

node scripts/postgres/atomicity.mjs
