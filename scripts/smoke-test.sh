#!/usr/bin/env bash
# ABOUTME: Self-host smoke test (PRD §20, §21) — boot the stack and issue a first key.
# ABOUTME: Verifies the "docker compose up -> first key" promise, not just that it builds.

set -euo pipefail

export ADMIN_TOKEN="${ADMIN_TOKEN:-smoke-admin-token-0123456789}"
export SIGNING_KEY_SECRET="${SIGNING_KEY_SECRET:-smoke-signing-secret-0123456789}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-smoke-postgres-password}"
export API_PORT="${API_PORT:-3000}"
# The production image deliberately refuses to start without a delivery provider. This
# journey issues a key manually and never sends mail, so a non-routable SMTP host is enough
# to exercise the production configuration path without contacting an external service.
export EMAIL_PROVIDER="${EMAIL_PROVIDER:-smtp}"
export SMTP_HOST="${SMTP_HOST:-smtp.invalid}"
URL="http://localhost:${API_PORT}"

cleanup() { docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Building and starting the stack"
docker compose up -d --build

echo "==> Waiting for /health"
for i in $(seq 1 30); do
  if curl -sf "$URL/health" >/dev/null 2>&1; then break; fi
  sleep 2
  if [ "$i" -eq 30 ]; then echo "health check never came up"; exit 1; fi
done

echo "==> Verifying the background worker stayed up"
docker compose ps --status running --services | grep -qx 'worker' || {
  docker compose logs --no-color worker >&2
  echo "worker is not running" >&2
  exit 1
}

echo "==> Verifying the production console build"
curl -sf "$URL/" | grep -q '<title>Cool Beans Console</title>' || {
  echo "console index was not served" >&2
  exit 1
}

echo "==> Creating a product"
curl -sf -X POST "$URL/admin/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"smoke","name":"Smoke","key_prefix":"SMK","email_from":"r@smoke.test"}' >/dev/null

echo "==> Issuing a key"
KEY=$(curl -sf -X POST "$URL/admin/keys" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"product":"smoke","email":"buyer@smoke.test","kind":"perpetual"}' | grep -o '"key":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$KEY" ]; then echo "no key issued"; exit 1; fi
echo "==> Issued $KEY"

echo "==> Activating it"
ACT=$(curl -sf -X POST "$URL/v1/activate" -H 'Content-Type: application/json' \
  -d "{\"license_key\":\"$KEY\",\"instance_name\":\"smoke-box\"}")
echo "$ACT" | grep -q '"ok":true' || { echo "activation failed: $ACT"; exit 1; }

echo "==> Smoke test passed: docker compose up -> product -> key -> activation"
