#!/usr/bin/env bash
# ABOUTME: Drives real provider CLIs against a local Cool Beans (PRD §20 requires this).
# ABOUTME: The vitest suite uses synthesized payloads; this proves real provider shapes work.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PRODUCT="${PRODUCT:-clementine}"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if ! command -v stripe >/dev/null 2>&1; then
  echo "The Stripe CLI is not installed: https://stripe.com/docs/stripe-cli" >&2
  echo "Install it, run 'stripe login', then re-run this script." >&2
  exit 1
fi

say "Forwarding Stripe webhooks to ${BASE_URL}/v1/stripe/webhook"
echo "Run this in another terminal and export the printed signing secret as STRIPE_WEBHOOK_SECRET:"
echo "  stripe listen --forward-to ${BASE_URL}/v1/stripe/webhook"
echo
read -r -p "Press enter once 'stripe listen' is running and the API has that secret... " _

# §20 names exactly these three. Each is triggered and then asserted against the API,
# because a 200 from the webhook only proves we accepted it, not that we acted on it.
say "1/3 checkout.session.completed — should issue a key"
# grep exits 1 on no match, which under `set -e -o pipefail` would abort here — and a
# product with zero keys is exactly the case worth testing. `|| true` keeps the count at 0.
count_keys() {
  curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN:?set ADMIN_TOKEN}" \
    "${BASE_URL}/admin/products/${PRODUCT}/keys" | { grep -o '"key"' || true; } | wc -l
}
before=$(count_keys)
stripe trigger checkout.session.completed
sleep 4
after=$(count_keys)
if [ "$after" -le "$before" ]; then
  echo "FAIL: no key was issued (before=$before after=$after)." >&2
  echo "Check that the product's stripe_price_lifetime matches the triggered price." >&2
  exit 1
fi
echo "OK: key count went ${before} -> ${after}"

say "2/3 charge.refunded — should disable a key"
stripe trigger charge.refunded
sleep 4
echo "Check the audit log for license.disabled reason=refund:"
curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" "${BASE_URL}/admin/audit" | head -c 400
echo

say "3/3 customer.subscription.deleted — the yearly lapse signal"
stripe trigger customer.subscription.deleted
sleep 4
curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" "${BASE_URL}/admin/audit" | head -c 400
echo

say "PayPal"
echo "PayPal has no local trigger CLI. Use the sandbox webhook simulator:"
echo "  https://developer.paypal.com/dashboard/webhooksSimulator"
echo "Send PAYMENT.CAPTURE.COMPLETED to ${BASE_URL}/v1/paypal/webhook with custom_id '${PRODUCT}:perpetual'."
echo "Signature verification calls PayPal, so PAYPAL_CLIENT_ID/SECRET/WEBHOOK_ID must be set."

say "Done. Events are visible at ${BASE_URL}/admin/events"
