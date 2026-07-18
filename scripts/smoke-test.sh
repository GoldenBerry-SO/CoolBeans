#!/usr/bin/env bash
# ABOUTME: Self-host smoke test (PRD §20, §21) — boot the stack and issue a first key.
# ABOUTME: Verifies the "docker compose up -> first key" promise, not just that it builds.

set -euo pipefail

export ADMIN_TOKEN="${ADMIN_TOKEN:-smoke-admin-token-0123456789}"
export SIGNING_KEY_SECRET="${SIGNING_KEY_SECRET:-smoke-signing-secret-0123456789}"
export API_PORT="${API_PORT:-3000}"
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

echo "==> Creating a product"
curl -sf -X POST "$URL/admin/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"smoke","name":"Smoke","key_prefix":"SMK","email_from":"r@smoke.test"}' >/dev/null

echo "==> Issuing a key"
KEY=$(curl -sf -X POST "$URL/admin/keys" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"product":"smoke","email":"buyer@smoke.test","tier":"lifetime"}' | grep -o '"key":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$KEY" ]; then echo "no key issued"; exit 1; fi
echo "==> Issued $KEY"

echo "==> Activating it"
ACT=$(curl -sf -X POST "$URL/v1/activate" -H 'Content-Type: application/json' \
  -d "{\"license_key\":\"$KEY\",\"instance_name\":\"smoke-box\"}")
echo "$ACT" | grep -q '"ok":true' || { echo "activation failed: $ACT"; exit 1; }

echo "==> Smoke test passed: docker compose up -> product -> key -> activation"
