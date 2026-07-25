#!/usr/bin/env bash
# ABOUTME: One command to run the commercial journeys: brings up mail + Stripe mock + API.
# ABOUTME: Everything is torn down on exit, so it leaves no containers or ports behind.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)
WORK=$(mktemp -d)
API_PORT=${API_PORT:-3098}
MOCK_PORT=${MOCK_PORT:-12111}

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Wait for a service to answer before using it. The mail sink is a container and the
# API compiles TypeScript on boot, so both take a moment; racing them produced a
# "socket closed" failure on the very first inbox call.
wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 60); do
    curl -sf "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "$name did not become ready at $url" >&2
  return 1
}
# tsx spawns a child, so killing the PID we hold leaves the real server bound to the
# port. A leftover server then answers the next run's health check while the new one
# fails to bind — which looked like a flaky assertion rather than a stale process.
free_ports() {
  fuser -k "$API_PORT/tcp" "$MOCK_PORT/tcp" >/dev/null 2>&1 || true
}
cleanup() {
	if [ -n "${API_PID:-}" ]; then kill "$API_PID" 2>/dev/null || true; fi
	if [ -n "${MOCK_PID:-}" ]; then kill "$MOCK_PID" 2>/dev/null || true; fi
	docker rm -f "${PG_NAME:-coolbeans-journey-pg}" >/dev/null 2>&1 || true
	free_ports
	rm -rf "$WORK"
}
trap cleanup EXIT

# Start from a clean slate: anything left behind would serve stale data.
free_ports
sleep 1

PG_PORT=${PG_PORT:-55442}
PG_NAME=coolbeans-journey-pg
PG_URL="postgres://postgres:beans@localhost:${PG_PORT}/coolbeans"
say "Postgres on :$PG_PORT"
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_NAME" \
  -e POSTGRES_PASSWORD=beans -e POSTGRES_DB=coolbeans \
  -p "${PG_PORT}:5432" postgres:16-alpine >/dev/null
# postgres:alpine runs initdb then restarts once, and pg_isready can pass on the pre-restart
# instance — the API then races in and hits "the database system is starting up". A real
# SELECT that succeeds proves the server is actually accepting queries, not just up.
for _ in $(seq 1 60); do
  docker exec "$PG_NAME" psql -U postgres -d coolbeans -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

say "Stripe stand-in on :$MOCK_PORT"
# The official stripe-mock serves canned fixtures, so a session's line items would never
# carry OUR product's price id — the exact thing worth asserting. This returns what the
# journey seeds instead.
PORT=$MOCK_PORT node scripts/journey/stripe-mock.mjs >"$WORK/mock.log" 2>&1 &
MOCK_PID=$!
wait_for "Stripe stand-in" "http://localhost:$MOCK_PORT/v1/checkout/sessions/none/line_items"

say "API on :$API_PORT (emails logged, real signature verification)"
LOG_MAGIC_CODES=true \
PORT=$API_PORT \
ADMIN_TOKEN=journey-admin-token-0123456789 \
SIGNING_KEY_SECRET=journey-signing-secret-0123 \
DATABASE_URL="$PG_URL" \
MIGRATE_ON_BOOT=true \
STRIPE_SECRET_KEY=sk_test_journey \
STRIPE_API_BASE="http://localhost:$MOCK_PORT" \
STRIPE_WEBHOOK_SECRET=whsec_journey \
EMAIL_PROVIDER=console \
PUBLIC_URL="http://localhost:$API_PORT" \
  npx tsx apps/api/src/node.ts >"$WORK/api.log" 2>&1 &
API_PID=$!

wait_for "API" "http://localhost:$API_PORT/health" || {
  cat "$WORK/api.log" >&2
  exit 1
}

say "Journeys"
if JOURNEY_API="http://localhost:$API_PORT" \
   JOURNEY_API_LOG="$WORK/api.log" \
   JOURNEY_STRIPE_MOCK="http://localhost:$MOCK_PORT" \
   STRIPE_WEBHOOK_SECRET=whsec_journey \
   ADMIN_TOKEN=journey-admin-token-0123456789 \
   node "$ROOT/scripts/journey/run.mjs"; then
  # The journeys prove the API answers correctly. This proves it wrote the right
  # rows underneath — a handler can return 200 and still corrupt what it stored.
  node "$ROOT/scripts/journey/validate-data.mjs" "$PG_URL"
  say "All journeys passed."
else
  echo
  echo "A journey failed. API log:" >&2
  tail -40 "$WORK/api.log" >&2
  exit 1
fi
