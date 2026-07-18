# Cool Beans — PRD validation

A section-by-section check of the v1 build against `docs/PRD.md`. Every row names where the behavior
lives and how it's verified. Test totals at time of writing: **225 automated tests** (189 API, 16 SDK, 5 email,
4 DB, 4 web, 4 logger, 3 CLI, 2 email) plus a **Docker Compose smoke test** that boots the stack and
issues a first key.

## §3 Goals

| Goal | Status | Where / evidence |
|---|---|---|
| Full lifecycle: issue, activate, validate, deactivate, suspend, revoke, re-enable | ✅ | `services/licensing.ts`, `services/lifecycle.ts`; `routes/v1/licensing.test.ts` |
| Lifetime, yearly, trial, floating models | ✅ | `licenses.tier`, `products.activation_model`; `floating.test.ts`, trial tests |
| Payments end-to-end (Stripe first, PayPal second) | ✅ | `services/stripe.ts`, `services/paypal.ts`; `webhooks/*.test.ts` |
| Usage metering with atomic quotas | ✅ | `services/usage.ts` (guarded UPDATE); `usage.test.ts` |
| Offline verification via signed tokens | ✅ | `domain/token.ts` (Ed25519), `services/signing.ts`; `token.test.ts`, e2e offline |
| Drop-in SDK | ✅ | `packages/sdk`; `sdk/index.test.ts`, `test/e2e.test.ts` |
| Admin dashboard + CLI | ✅ | `apps/web` console, `packages/cli`; browser-verified |
| Self-host + cloud from one codebase | ✅ | Docker/compose + k8s GitOps; smoke test green |
| Lemon Squeezy API parity | ✅ | `routes/v1/ls.ts`; `ls.test.ts` |

## §9 Public client API (the frozen contract)

| Endpoint / rule | Status | Evidence |
|---|---|---|
| `POST /v1/activate` — seats, reuse, 422/404/403/409 | ✅ | `routes/v1/index.ts`; `licensing.test.ts` covers all four codes + reuse |
| Live-seat count = `deactivated_at IS NULL`, atomic | ✅ | Guarded INSERT in `licensing.ts`; seat-limit + reuse tests |
| `POST /v1/validate` — known key always 200, token on live instance | ✅ | `validate` tests incl. disabled-returns-200 |
| Unknown key is 404, never disabled | ✅ | Explicit tests in `licensing.test.ts` and `e2e.test.ts` |
| `POST /v1/deactivate` — idempotent | ✅ | `deactivate` idempotency test |
| `POST /v1/heartbeat` — floating lease renew, auto-free on expiry | ✅ | `floating.test.ts` |
| `POST /v1/usage/increment` + `GET /v1/usage` | ✅ | `usage.test.ts` |
| LS-parity `/v1/licenses/*` | ✅ | `ls.test.ts` (activated/valid/deactivated + status mapping) |
| license object shape (`key,status,tier,product,expires_at`) | ✅ | `http/serializers.ts`; asserted throughout |

## §10 Key generation

| Rule | Status | Evidence |
|---|---|---|
| Format, ambiguity-free alphabet, rejection sampling | ✅ | `domain/keygen.ts`; `keygen.test.ts` (format, alphabet, no-bias) |
| Normalized storage + shared normalizer, reject before storage | ✅ | `parseKey`/`normalizeAgainst`; used at every edge |
| UNIQUE + regenerate on collision (≤3) | ✅ | `issueLicense` retry loop; DB UNIQUE |

**Note (spec discrepancy):** §10 says "16 characters after the prefix" (78 bits), but the §9 *example*
`CLEM-A2B3-C4D5-E6F7` shows only 12. The build follows §10's normative 16-char spec (4 groups of 4,
`CLEM-XXXX-XXXX-XXXX-XXXX`), which also preserves the "prefix plus 16 alphanumerics" LS-compat claim.
Confirm the §9 example is just illustrative; if 12 chars is intended, it's a one-line change in keygen.

## §11 Offline tokens + SDK

| Rule | Status | Evidence |
|---|---|---|
| Ed25519 signed tokens, per-product keys, encrypted at rest | ✅ | `domain/crypto.ts` (AES-GCM/HKDF), `services/signing.ts` |
| Configurable TTL, rotation (multiple active public keys) | ✅ | `config.tokenTtlDays`, `rotateKey`; `token.test.ts` rotation |
| SDK activate/verify/verifyOffline/deactivate + fingerprint | ✅ | `packages/sdk`; `sdk/index.test.ts` |
| Offline-tolerant: network error never locks; only `disabled` revokes | ✅ | SDK `verify` returns `offline:true`; `verifyOffline` grace state; e2e |
| WebCrypto verification (browser + Node) | ✅ | `sdk/token.ts`; e2e verifies a real server-signed token offline |

## §12 Usage metering

| Rule | Status | Evidence |
|---|---|---|
| Atomic guarded increment (no double-pass) | ✅ | `incrementUsage` single guarded UPDATE; overshoot test |
| Auto-reset daily/monthly | ✅ | `applyResetIfDue`; reset test |
| 429 quota_exceeded same body shape | ✅ | `usage.test.ts` |

## §13 Payments

| Rule | Status | Evidence |
|---|---|---|
| Stripe signature verify before parse | ✅ | `routes/webhooks/stripe.ts`; invalid-signature test |
| checkout.session.completed → ensureLicenseForSession | ✅ | `services/stripe.ts` + `payments.ts` |
| Basil: current_period_end from subscription item | ✅ | `stripe-gateway.ts`, `subscriptionPeriodEnd`; yearly test |
| charge.refunded full-only (partial keeps active) | ✅ | partial-refund test |
| dispute.created → chargeback disable | ✅ | dispute test |
| subscription.updated renewal + unpaid-lapse | ✅ | renewal + unpaid tests |
| subscription.deleted → yearly lapse | ✅ | lapse test |
| Idempotency: provider_events + checkout_id UNIQUE | ✅ | redelivery test; event recorded only on success |
| Email failure → 500, retry only email | ✅ | email-retry test |
| PayPal parallel adapter | ✅ | `paypal.test.ts` |
| Purchase lookup for success page | ✅ | `purchase.test.ts` |
| `beans stripe connect` (prices + webhook) | ✅ | `stripe-connect.test.ts`, CLI `stripe connect` |

## §14–§16 Delivery, portal, admin

| Rule | Status | Evidence |
|---|---|---|
| Email: Resend + SMTP adapters, key email, email_sent_at | ✅ | `packages/email/senders.ts`, `services/email.ts` |
| Two-channel delivery (webhook + success page), one issuance path | ✅ | `payments.ensureLicense` idempotent; purchase-lookup |
| Customer portal: license view + seat deactivation | ✅ | `routes/v1/portal.ts` + `apps/web` Portal; browser-verified |
| Admin API: product CRUD, manual issue, disable/enable, listings, purchase lookup | ✅ | `routes/admin/*`; browser-verified create+issue |
| Dashboard: products/licenses/audit with live data | ✅ | `apps/web` console; browser-verified |
| Audit log: every state change with actor | ✅ | `store/audit.ts`; `/admin/audit` |
| CLI-first (`beans …`) | ✅ | `packages/cli` (product, key, purchase, stripe) |

## §17 Data model

All tables present (`products, purchases, licenses, activations, metrics, usage_counters,
signing_keys, provider_events, audit_log`, plus `outbox` for durable jobs) with the specified
constraints, indexes, and the partial live-activation index. Migrations apply on boot. `packages/db`,
`index.test.ts`.

## §18–§19 Deployment & security

| Rule | Status | Evidence |
|---|---|---|
| Self-host `docker compose up` | ✅ | `Dockerfile`, `docker-compose.yml`; smoke test green |
| Cloud on k8s (Docker → GHCR → GitOps) | ✅ | `.github/workflows/deploy.yml` |
| Migrations on boot | ✅ | `node.ts` calls `migrate` |
| Rate limiting 30/min on /v1 (webhook excluded), Redis-backed | ✅ | `middleware/rate-limit.ts` + `redis-store.ts`; `rate-limit.test.ts` |
| Uniform error shapes, format check before storage | ✅ | `http/errors.ts`; parse-before-lookup |
| Webhook signature mandatory | ✅ | both webhook routes reject unverified |
| Admin bearer token, constant-time compare, never logged | ✅ | `middleware/admin-auth.ts` |
| Secrets server-side only; clients hold none | ✅ | SDK carries no secret; key is the credential |

## §20 Testing

Unit + integration (vitest) across key gen/normalization, the full activate/validate/deactivate
policy, floating lease/heartbeat, metering atomicity, offline sign/verify/rotation, webhook signature
rejection + idempotency (Stripe + PayPal), lapse-to-disable and trial-expiry, plus the **end-to-end
simulation suite** (`test/e2e.test.ts`) driving the real SDK through every flow, and the **Docker
Compose smoke test**.

## Deliberate scope notes

- **Postgres (issue #32):** the data layer is synchronous better-sqlite3; the production path is
  libSQL (same sync API, distributed). A true Postgres adapter needs an async refactor across all
  services — documented in `ARCHITECTURE.md`, not shipped as broken code.
- **Better Auth dashboard sessions (#26):** the console uses a token-paste gate today (the PRD listed
  session-vs-token as an open decision). Better Auth wiring is the follow-up; `packages/auth` scaffolds it.
- **Native SDK stubs (Swift/C#/C++):** PRD marks these v1-or-fast-follow; not built.
- **Dashboard export / some read-only views (Customers/Usage/Webhooks aggregates):** the console
  ships functional read+write for the core flows; a few aggregate views remain placeholders.

## Provider CLI checks (PRD §20)

The vitest webhook suites use synthesized payloads, which proves our handling but not
that real provider payloads still match it. `scripts/provider-webhook-check.sh` drives
the real Stripe CLI (`stripe trigger checkout.session.completed | charge.refunded |
customer.subscription.deleted`) against a local server and asserts a key was actually
issued, rather than just that the webhook returned 200. PayPal has no local trigger, so
the script points at the sandbox simulator with the payload shape to send.

Run it before a release, or after any change to `services/stripe.ts`.

## Commercial journeys (`scripts/journey/`)

The vitest suites prove the internals; these prove the thing customers actually pay for.
One command stands up the whole world and tears it down again:

```
./scripts/journey/journey.sh
```

It runs a Stripe stand-in and the API with emails logged rather than sent, then walks
four journeys with hard assertions. No containers, no mail service, nothing to install:
`node` is enough.

1. **Buy a lifetime licence and run it on three machines.** A signature-valid
   `checkout.session.completed` issues the key; the buyer's email is asserted to carry the
   key, the download link and the product's own from-address; a forged signature is
   rejected; a redelivery produces neither a second key nor a second email; the success
   page reads the same purchase; three machines activate and the fourth is refused; the
   real published SDK verifies online and then offline.
2. **Refund.** A partial refund leaves the licence alone; a full refund disables it with
   `reason=refund`, the running app sees a definitive (never inconclusive) signal, its
   cached offline token stops working, and a fresh activation is refused.
3. **Yearly renew and cancel.** The purchase dates the key to the period end, renewal
   advances it, cancellation disables with `reason=subscription_canceled`, and a lifetime
   licence is proven untouched by subscription events.
4. **Self-service.** Key recovery emails the keys and never returns them in the response,
   and an unknown address gets a byte-identical answer with no email sent.

Two deliberate choices worth knowing:

- **Real signatures, not a bypass.** `stripe-sign.mjs` builds the same HMAC Stripe does, so
  the server's real `constructEvent` verifies it. A suite that skipped signatures would not
  have caught connect blanking a stored webhook secret.
- **Emails are read from the log, not from a mail service.** `EMAIL_PROVIDER=console`
  makes the API log each rendered email instead of delivering it, so local work needs no
  mail provider and the journeys assert on the exact React Email HTML a buyer would get.
  It refuses to start under `NODE_ENV=production`, because an instance that quietly logs
  key emails instead of sending them looks healthy while every buyer waits forever.
  The **Resend** adapter that actually ships (§14) is pinned separately in
  `packages/email/src/senders.test.ts`, which asserts the request it posts — endpoint,
  API key header, and the rendered payload — so the production path stays covered without
  a mail service in the loop.
- **Our own Stripe stand-in, not `stripe-mock`.** The official mock serves canned fixtures,
  so a session's line items would never carry the price id our product is configured with —
  which is exactly the assertion that catches issuance resolving to the wrong product.
  `STRIPE_API_BASE` exists solely to point the SDK at it and is unset in production.
