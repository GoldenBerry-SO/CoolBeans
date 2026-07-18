#!/usr/bin/env bash
# ABOUTME: One command to run the commercial journeys: brings up mail + Stripe mock + API.
# ABOUTME: Everything is torn down on exit, so it leaves no containers or ports behind.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)
WORK=$(mktemp -d)
API_PORT=${API_PORT:-3098}
MOCK_PORT=${MOCK_PORT:-12111}
MAIL_SMTP=${MAIL_SMTP:-1025}
MAIL_HTTP=${MAIL_HTTP:-8025}

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
  docker rm -f cb-journey-mail >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

say "Mail sink (Mailpit): SMTP :$MAIL_SMTP, web UI http://localhost:$MAIL_HTTP"
docker rm -f cb-journey-mail >/dev/null 2>&1 || true
docker run -d --name cb-journey-mail -p "$MAIL_SMTP:1025" -p "$MAIL_HTTP:8025" axllent/mailpit >/dev/null

say "Stripe stand-in on :$MOCK_PORT"
# The official stripe-mock serves canned fixtures, so a session's line items would never
# carry OUR product's price id — the exact thing worth asserting. This returns what the
# journey seeds instead.
PORT=$MOCK_PORT node scripts/journey/stripe-mock.mjs >"$WORK/mock.log" 2>&1 &
MOCK_PID=$!

say "API on :$API_PORT (real SMTP delivery, real signature verification)"
LOG_MAGIC_CODES=true \
PORT=$API_PORT \
ADMIN_TOKEN=journey-admin-token-0123456789 \
SIGNING_KEY_SECRET=journey-signing-secret-0123 \
DATABASE_URL="$WORK/journey.sqlite" \
STRIPE_SECRET_KEY=sk_test_journey \
STRIPE_API_BASE="http://localhost:$MOCK_PORT" \
STRIPE_WEBHOOK_SECRET=whsec_journey \
EMAIL_PROVIDER=smtp SMTP_HOST=localhost SMTP_PORT=$MAIL_SMTP \
PUBLIC_URL="http://localhost:$API_PORT" \
  npx tsx apps/api/src/node.ts >"$WORK/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 30); do
  curl -sf "http://localhost:$API_PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://localhost:$API_PORT/health" >/dev/null || {
  echo "API did not come up. Log:" >&2
  cat "$WORK/api.log" >&2
  exit 1
}

say "Journeys"
if JOURNEY_API="http://localhost:$API_PORT" \
   JOURNEY_MAIL="http://localhost:$MAIL_HTTP/api/v1" \
   JOURNEY_STRIPE_MOCK="http://localhost:$MOCK_PORT" \
   STRIPE_WEBHOOK_SECRET=whsec_journey \
   ADMIN_TOKEN=journey-admin-token-0123456789 \
   node "$ROOT/scripts/journey/run.mjs"; then
  say "All journeys passed."
else
  echo
  echo "A journey failed. API log:" >&2
  tail -40 "$WORK/api.log" >&2
  exit 1
fi
