# Cool Beans — Product Requirements Document

> **Cool Beans** — the open-source license layer. Issue a key, activate it, check it's still good.
> "Your licence? Cool beans — you're all set."
>
> Working name: **Cool Beans** · Domain: `coolbeans.tools` · npm: `@coolbeans/sdk` · CLI: `beans` · Cloud: `app.coolbeans.tools`
> Operator of the hosted instance: **Goldenberry** · First product on it: **Clementine**
> Status: Draft v1 · Owner: Goldenberry · Build in its own repo / standalone.

Throughout this doc, `<PREFIX>` is a product's key prefix (Clementine's is `CLEM`). The client-facing
contract in **§9 is frozen first** — Clementine and every other product builds against it, so it must
not drift once a product ships.

---

## 1. Summary

Cool Beans is a small, open-source service that issues and validates software license keys and turns
payment events into license state. A customer buys on Stripe (or PayPal), gets a key, activates it on
their machines, and Cool Beans is the source of truth for whether that key is still good.

It is **general** (many products, one service), **open source and self-hostable under MIT** (anyone
can run their own with no strings), with a **hosted cloud instance** as the convenience option.
Goldenberry runs the cloud instance; Clementine is its first product. It is a **drop-in for the Lemon
Squeezy License API**, so existing clients barely change.

It replaces what Lemon Squeezy did for Goldenberry products and matches the feature depth of the
commercial incumbents (Keygen, Cryptlex, keygate) while staying deliberately smaller, permissively
licensed, and lightweight.

---

## 2. Problem & why it exists

- **Lemon Squeezy's account verification stalled, blocking sales.** We want to own the license layer,
  not depend on a reseller's approval or roadmap.
- **The buy → key → activate → validate problem recurs across every Goldenberry product** (Clementine
  today; Hexis, PhotoGlide, Pace, and others later). Build it once, reuse it.
- **Stripe has no native license-key feature** (confirmed against 2026 Stripe docs and Sessions 2026;
  Stripe Managed Payments is a merchant-of-record option but still does not issue keys). The glue is
  ours to build regardless of which Stripe billing flavour we use.
- **The incumbents each have a gap we can exploit** (see §5): Keygen is "Fair Source" (restricted) and
  Rails-only; Cryptlex/LicenseSpring are heavy and not Stripe-first; the one philosophically-aligned
  open-source project (keygate) is Go, AGPL-with-attribution, and has near-zero traction. Nobody ships
  a *truly-MIT, minimal, Node-native, Lemon-Squeezy-drop-in* license service.

---

## 3. Goals & non-goals

### Goals (v1)

1. Full license lifecycle: issue, activate, validate, deactivate, suspend, revoke, re-enable.
2. Every license model that matters: **lifetime** (perpetual), **yearly** (subscription), **trial**,
   and **floating** (concurrent seats).
3. **Payments end-to-end**: Stripe first (5-minute onboarding, auto webhook), PayPal as a second
   provider. Payment in → license out; refund/lapse → license disabled.
4. **Usage metering** with atomic quota enforcement.
5. **Offline verification** via signed tokens, so self-signed desktop and Electron apps keep working
   with no network.
6. A **drop-in SDK** that adds licensing to a Node/Electron/Tauri/browser app in minutes.
7. **Admin dashboard** + CLI to run the business.
8. **Self-host (MIT) and cloud (our k8s infrastructure: Docker + Postgres + Redis)** from one codebase.
9. **Lemon Squeezy API parity** so existing clients migrate with a base-URL change.

### Non-goals (v1)

- Merchant-of-record / tax handling (that stays with Stripe/PayPal). This is about our customers'
  sales of their own software; our own subscription billing is §7.
- Licensing models beyond the four above (no feature-flag entitlement graphs, no per-API-key rate
  plans as a product).
- Payment providers beyond Stripe and PayPal in v1 (the issuance core is provider-pluggable so a
  third is an adapter, not a rewrite).

---

## 4. Target users & first customer

- **Primary buyer:** indie and small software businesses selling desktop, CLI, or SaaS software who
  want to own their license layer without paying per-active-user fees.
- **Self-hosters:** developers who want to run the whole thing on their own box with one
  `docker compose up`, under a licence with no asterisks.
- **First customer:** **Clementine** (prefix `CLEM`), migrating off Lemon Squeezy. Its client code is
  written to the LS License API shape, which §9 preserves.

---

## 5. Competitive landscape

The niche we're targeting — "boring, small, self-hostable, Stripe-native, LS-parity license service" —
is validated as a *desire* but essentially unclaimed. Traction sits with the heavyweight OSS incumbent
(Keygen) or the hosted-only newcomers (Keyforge, LicenseSeat). The one project built to our exact
philosophy, **keygate**, has ~11 GitHub stars, is pre-1.0, Go, and AGPL-with-attribution.

| | **Cool Beans** | Keygen | Cryptlex / LicenseSpring | keygate | Lemon Squeezy | LicenseSeat |
|---|---|---|---|---|---|---|
| Licence | **MIT (truly OSS)** | Fair Source (restricted) | Closed | AGPL + attribution | Closed | Closed |
| Self-host | **✓** | ✓ (CE) | On-prem (enterprise) | ✓ | — | — |
| Lightweight self-host (one compose file) | **✓ (Hono, Node)** | — (Rails) | — | ~ (Go) | — | — |
| Lifetime + subscription | **✓** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trial licenses | **✓** | ✓ | ✓ | ✓ | ~ | ✓ |
| Floating licenses | **✓** | ✓ | ✓ | ✓ | — | — |
| Usage metering | **✓** | — | — | ✓ | — | — |
| Built-in payments (Stripe) | **✓ (5-min onboarding)** | — | — | ✓ | ✓ (is MoR) | via LS |
| PayPal | **✓** | — | — | ~ | — | — |
| Offline token verify | **✓ (Ed25519)** | ✓ | ✓ | ✓ | — | ✓ |
| Drop-in SDK (Electron/Tauri) | **✓** | ~ | ✓ | ~ | ~ | ✓ |
| Customer portal | **✓** | — | ✓ | ✓ | ✓ | ✓ |
| LS-parity API (drop-in migrate) | **✓** | — | — | — | n/a | ~ |
| Pricing | **Flat $99/yr or free self-host** | Per active user | Enterprise seats | Free (AGPL) | % of sales | $9–79+/mo by device |

Sources for this table are captured in the accompanying competitor-analysis note.

---

## 6. Positioning & differentiation

Three things are ours and nobody with traction offers all three:

1. **Small and boring from one codebase.** A single Node/Hono service runs our hosted cloud (k8s)
   and any self-host box — one `docker compose up`, SQLite or Postgres, no Rails stack to babysit
   (Keygen) and no enterprise on-prem ceremony (Cryptlex). "First key in under 10 minutes" is a real
   indie story.
2. **Genuinely open.** MIT beats Keygen's Fair Source restrictions and keygate's AGPL-plus-attribution
   on the "no strings" axis — the most common complaint about the incumbents.
3. **A drop-in for the Lemon Squeezy installed base.** A large body of client code is already written
   against LS's `activate/validate/deactivate` shape (§9 preserves it). That's a migration story none
   of the OSS incumbents lead with.

Headline promise for the site: **"Licensing you actually own. Stop paying per-seat to manage your own
keys."** And the pricing dunk: **"We don't charge per license. Your growth is not our upsell."**

That dunk has to stay literally true, so be precise about what it claims. Free carries a fair-use
ceiling (§7), but crossing it costs a flat $99 a year however far you then grow. Nothing we charge
scales with your success — that is the difference from incumbents who meter continuously. Do not
write copy that implies Free is uncapped.

---

## 7. Pricing & packaging

The incumbents meter on the thing that grows with your success (active users, devices, licenses). Our
marginal cost per validate is ~one indexed read, so we don't need to. Two options, mirroring how our own
products are sold (own it, or subscribe):

- **Self-host — free forever.** MIT. Unlimited products, keys, activations, validations, metering,
  seats. You run it; you own it. This is the "lifetime" equivalent.
- **Cloud Free.** One product, up to 500 active licences, unlimited validations, emails from a shared
  sender — enough to ship and to get your first few hundred customers. Validations are never capped,
  and the caps are enforced on *creation* only: going over never disables or deletes anything, and a
  licence bought through a webhook past the cap is still issued (§8). You are asked to upgrade, never
  cut off.
- **Cloud Pro — $99 / year, flat.** Unlimited products, keys, activations, validations, metering
  events, and seats. Managed hosting, managed email deliverability (your own sending domain),
  automatic Stripe/PayPal webhook wiring, hosted success + portal endpoints, daily backups, priority
  support. **No per-seat, per-license, per-active-user, or percentage-of-sales fees, ever.**

Fair-use guardrail: the cloud is for *your own products*, not resold as a licensing service to third
parties.

**Tenancy.** The hosted service is multi-tenant: signing up creates an account, and an account owns
its products and its admin users. Self-host stays single-account, keeps `ADMIN_TOKEN`, and has no
plan and no limits — it reaches "unlimited" through the same code path the plans use, not a parallel
branch. An instance is in cloud mode exactly when platform billing is configured, so it can never
enforce a limit that nobody has a way to pay to lift.

---

## 8. Design principles

- **Boring and small.** Node/TypeScript with [Hono](https://hono.dev); one codebase serves the
  self-host story and our hosted cloud (k8s). Storage behind a thin adapter: SQLite for dev and
  lightweight self-host, Postgres for production. A migration tool applies the schema on boot.
- **Multi-product and multi-tenant.** An account owns its products and admin users; the hosted service
  takes public signups. Self-host stays single-account and unlimited. See §7 for the tenancy model.
- **Provider-pluggable payments.** The payment webhook and the issuance core are separated so a new
  provider is an adapter, not a rewrite.
- **The key is the credential.** Public endpoints authenticate by the key itself; the client carries no
  service secret. Admin endpoints use bearer tokens. Cool Beans holds the Stripe/PayPal/email secrets;
  clients hold none.
- **Offline-tolerant by contract.** A network failure or inconclusive answer never locks a user out.
  Only an explicit `disabled` signal revokes access.

---

## 9. Public client API (frozen contract)

All JSON. The key is the credential; the product is resolved from the key's prefix. Every response body
carries `ok` — except the `/v1/licenses/*` compatibility routes below, which reproduce the Lemon
Squeezy shape exactly and therefore omit it. This is a superset-compatible drop-in for the Lemon Squeezy License API.

The `license` object is identical wherever it appears:

```json
{ "key": "CLEM-A2B3-C4D5-E6F7-H8JK", "status": "active", "tier": "yearly",
  "product": "clementine", "expires_at": "2027-07-17T09:14:00Z" }
```

`status` is `active` or `disabled`. `tier` is `lifetime` | `yearly` | `trial`. `product` is the slug (a
client fails activation closed unless the product it expects matches). `expires_at` is ISO 8601 or
`null` for lifetime; it is advisory for yearly (a renewal date, never enforced on the client's own
clock) and **enforced only for `trial`**.

### Behaviour the contract guarantees

- **Issue** a key on purchase. No per-user login, no OAuth.
- **Activate** on a device → instance id, enforcing an **activation limit** (default 3 seats).
- **Validate** a key + instance. Advisory; clients stay offline-tolerant.
- **Deactivate** an instance to free a seat. Idempotent.
- A key can be **disabled** (refund, revocation, lapsed subscription). `disabled` is the single signal
  a client acts on to revoke access.
- **An unknown key returns `404`, never `disabled`.** A data gap or not-yet-imported key must never be
  read as revocation, or an offline machine would lock out on its next revalidation.

### `POST /v1/activate`

Request: `{ "license_key": "CLEM-…", "instance_name": "Chris's MacBook Pro" }`

- `200` `{ "ok": true, "license": {…}, "instance": { "id": "<uuid>", "name": "…" } }`
- Errors, all `{ "ok": false, "error": "<code>", "message": "<human sentence>" }`:
  - `422 invalid_key` (fails the format check)
  - `404 unknown_key`
  - `403 license_disabled` (fail closed)
  - `409 activation_limit_reached` (message names the limit; support/portal frees a seat)
- Live-seat count = activations where `deactivated_at IS NULL`. Reactivating the same device reuses its
  instance rather than burning a seat (match `instance_name` when present).

### `POST /v1/validate`

Request: `{ "license_key": "CLEM-…", "instance_id": "<uuid>" }`

- A **known** key always returns `200`, including a disabled one, so the client sees the definitive
  signal: `{ "ok": true, "valid": false, "license": { "status": "disabled", … }, "instance": null }`
- Active key + live instance: `{ "ok": true, "valid": true, "license": {…}, "instance": {…},
  "token": "<offline-token>" }` and updates `last_validated_at`.
- Active key but unknown/deactivated instance: `valid: false` with `license.status: "active"`. Per
  policy a client does **not** downgrade on this (only `disabled` downgrades).
- `404 unknown_key` / `422 invalid_key`: inconclusive; never a lockout.

The `token` is the signed offline credential (§11).

### `POST /v1/deactivate`

Request: `{ "license_key": "CLEM-…", "instance_id": "<uuid>" }`

- `200 { "ok": true }`. Idempotent: an already-deactivated or unknown instance still returns `ok`. Sets
  `deactivated_at`, freeing the seat.

### `POST /v1/heartbeat` (floating licenses)

Request: `{ "license_key": "CLEM-…", "instance_id": "<uuid>" }`

- Renews a floating lease (`lease_expires_at`), keeping the seat held. An expired lease frees the seat
  automatically, so a crashed client never permanently consumes a floating seat. `200 { "ok": true,
  "lease_expires_at": "…" }`. `lease_expires_at` is `null` when nothing was renewed — an unknown or
  deactivated instance, a lapsed lease with no free seat, or a node-locked product — so a client can
  tell "lease held" from "re-activate before continuing". Node-locked products can ignore this endpoint.

### Usage endpoints (metering)

- `POST /v1/usage/increment` — `{ "license_key": "…", "instance_id": "…", "metric": "api_calls",
  "delta": 1 }` → `{ "ok": true, "current": 9847, "limit": 10000, "resets_at": "…" }`. Enforced
  atomically (§12); over-limit returns `429 quota_exceeded` with the same body shape.
  Metering is bound to a live seat: `instance_id` must name an activation on this license that has
  not been deactivated, otherwise `404 unknown_instance`. Deactivating a device therefore stops its
  metering along with its seat, and unknown and deactivated instances answer identically so the
  endpoint never confirms an instance id once existed. A lapsed floating lease is deliberately not
  rejected — that seat frees itself without telling the client, and failing a running client's
  metering mid-session would be a surprise; re-activation is the client's signal.
- `GET /v1/usage?license_key=…` — current counters for a key:
  `{ "ok": true, "usage": [ { "metric": "api_calls", "current": 9847, "limit": 10000,
  "resets_at": "…" } ] }`. `limit` is `null` when the metric has no cap. Same `404 unknown_key` /
  `422 invalid_key` resolution as the other endpoints.

### Lemon Squeezy compatibility routes (validated 2026-07-17)

The real LS License API lives at `POST /v1/licenses/activate|validate|deactivate` and returns
`activated` / `valid` / `deactivated` booleans, `error` (human message or `null`), a `license_key`
object (`id`, `status`, `key`, `activation_limit`, `activation_usage`, `created_at`, `expires_at`),
an `instance` object (`id`, `name`, `created_at`), and a `meta` object. A base-URL-swap migration
therefore requires more than the shapes above: Cool Beans also serves **alias routes at
`/v1/licenses/*`** that emulate the LS request/response contract exactly (status mapping: our
`disabled` → LS `disabled`; an expired trial → LS `expired`), while the native `/v1/*` routes carry
the clean contract defined in this section. Both route families hit the same handlers; the alias
layer is a serializer, not a second implementation. The parity test suite pins both.

---

## 10. Key generation

Format `<PREFIX>-XXXX-XXXX-XXXX`: 16 characters after the prefix, drawn from
`ABCDEFGHJKMNPQRSTVWXYZ23456789` (A–Z, 2–9, minus ambiguous I, L, O, U, 0, 1). Still 16 ASCII
alphanumerics, so a client that validates "prefix plus 16 alphanumerics" accepts it.

- Draw with `crypto.getRandomValues` + rejection sampling (no modulo bias).
- Store normalized (dashes stripped, uppercased). Enforce the `UNIQUE` constraint; regenerate on the
  rare collision (retry ≤ 3).
- ~78 bits of entropy: unguessable, so key validity is not a useful enumeration oracle.
- One shared normalization helper for every endpoint: strip dashes/whitespace, uppercase, then check
  `<PREFIX>` plus exactly 16 of the alphabet. Reject the malformed before touching storage.

---

## 11. Offline verification & the SDK (the "super easy to integrate" pillar)

This is the differentiator that matters most to buyers shipping desktop/Electron apps: adding
licensing must be a five-minute, few-line job, and the app must keep working offline.

### Offline tokens

On a successful `validate`, Cool Beans returns a compact **Ed25519-signed token** (a JWT-style
structure) carrying `{ key, status, tier, product, expires_at, instance_id, iat, exp }` with a short
TTL (default 7 days). The SDK caches it and can verify it **with no network** against a public key
bundled in the app. Behaviour:

- Online: SDK calls `validate`, refreshes the token.
- Offline / network error: SDK verifies the cached token's signature locally. If still within TTL →
  treat as valid. Past TTL → keep trying online but **stay in a grace state**, never hard-lock on a
  network failure (offline-tolerant contract, §8).
- Only an explicit `disabled` result (or a signed "disabled" token) revokes access.
- **A signed `expires_at` in the past ends access, offline included, for every tier.** This is not a
  lockout on an inconclusive answer: the token we issued states the licence ended, so honouring it is
  reading our own credential rather than guessing from a network failure. It is what makes
  subscription revocation reach a machine that has gone offline. Lifetime licences carry no
  `expires_at` and are unaffected; trials additionally get no TTL grace, or a blocked endpoint would
  be an unlimited trial.
- The date in the token is the server's choice, not the licence's raw expiry. It carries a buffer
  (`OFFLINE_TOKEN_BUFFER_DAYS`, default 14) so a subscriber who renews while offline — and is still
  holding a token stamped with the old date — has room to reconnect rather than being locked out of
  something they paid for. The policy lives on the server so it can change without an app update.
  Never applied to trials, and never to a lifetime licence, which has no expiry to buffer.

Signing keys are per-product (or global), stored server-side with the private half encrypted at rest;
the public half is what apps embed. Key rotation is supported (multiple active public keys).

### The SDK — `@coolbeans/sdk`

Runs in the Electron main process, Tauri, plain Node, and the browser (WebCrypto). No service secret in
the client.

```ts
import { CoolBeans } from '@coolbeans/sdk'

const cb = new CoolBeans({ product: 'clementine' }) // no secret — the key is the credential

// Activate on this device (e.g. Electron main / Tauri)
const { instance } = await cb.activate(licenseKey, { name: cb.fingerprint() })

// Verify — returns a cached, offline-verifiable signed token
const res = await cb.verify(licenseKey, { instanceId: instance.id })
if (res.valid) unlockApp()          // online path
if (cb.verifyOffline()) unlockApp() // no-network path: local signature check

// Free a seat
await cb.deactivate(licenseKey, { instanceId: instance.id })
```

- `cb.fingerprint()` — a stable device-name/id helper.
- `cb.verifyOffline()` — local Ed25519 check of the cached token; returns valid/grace/expired.
- Framework quickstarts shipped in docs: **Electron**, **Tauri**, **plain Node/CLI**, **browser**.
- **Migrating from Lemon Squeezy:** point the SDK/base URL at Cool Beans; the request/response shapes in
  §9 match, so client changes are minimal.

Native SDK stubs (Swift / C# / C++) are a fast-follow, mirroring the same activate/verify/deactivate
surface for non-JS desktop apps.

---

## 12. Usage metering

Track API calls, storage, bandwidth, or product-defined metrics, with quotas enforced **atomically at
the database level** so two concurrent requests can never both pass a limit check.

- Postgres: `SELECT … FOR UPDATE` / `UPDATE … WHERE current + :delta <= limit RETURNING current`.
- SQLite: a single guarded `UPDATE … WHERE current + :delta <= limit RETURNING current` inside a
  transaction, which is atomic on the row.
- Auto-reset periods (`daily` / `monthly` / none) with `period_start` / `resets_at`.
- Over-limit → `429 quota_exceeded`. Custom metrics defined per product by the admin.

---

## 13. Payments

Onboarding a product is: create prices, give Cool Beans the price ids, point one webhook at the
service, paste the signing secret — and for Stripe we automate the webhook creation so it's genuinely a
five-minute job.

### Stripe (primary)

Signature-verified with the official `stripe` SDK
(`stripe.webhooks.constructEvent(rawBody, sig, secret)` against the raw request body). "Easy
onboarding" specifics: `beans stripe connect` (CLI) or an admin action creates the two
prices (one-time lifetime, recurring yearly) and **auto-registers the webhook endpoint via the Stripe
API**, then stores the signing secret — no manual dashboard wiring.

`POST /v1/stripe/webhook` handles the table below, plus
`checkout.session.async_payment_succeeded` and `charge.dispute.created` per the integration notes
that follow:

| Event | Action |
| --- | --- |
| `checkout.session.completed` | Resolve product + tier from the session's price id, then `ensureLicenseForSession(session)`: insert the purchase, issue the key, send the key email. Tier from `session.mode` (`payment` = lifetime, `subscription` = yearly); yearly fetches the subscription for `current_period_end` → `expires_at`. |
| `charge.refunded` | Find the purchase via `charge.payment_intent`; disable the key, `reason=refund`. |
| `customer.subscription.updated` | Find the purchase via `stripe_subscription_id`; set `expires_at = current_period_end`. Covers renewals and scheduled cancels (key stays active, date stops advancing). |
| `customer.subscription.deleted` | Disable the key, `reason=subscription_canceled`. **This is the yearly-lapse enforcement**, fired at the end of the paid-through period. Lifetime keys are never touched by subscription events; they die only on refund. |

### Stripe integration notes (validated against 2026 Stripe API, 2026-07-17)

- **`current_period_end` lives on subscription items now.** Since API version `2025-03-31.basil`
  (which the pinned `stripe` v22 SDK uses), the Subscription object no longer carries
  `current_period_start/end`; read `subscription.items.data[0].current_period_end` instead.
- **Renewal refunds don't match the stored payment intent.** The purchase row stores the checkout's
  `payment_intent`; a refunded *renewal* invoice has a different one. `charge.refunded` must fall
  back to resolving `charge.invoice → invoice.subscription → purchases.provider_subscription_id`.
- **Partial refunds fire `charge.refunded` too.** Only a full refund
  (`charge.amount_refunded === charge.amount_captured`) disables the key; a partial refund is
  recorded in the audit log but leaves the license active.
- **Disputes:** handle `charge.dispute.created` → disable the key (`reason=chargeback`), resolved
  via the same payment-intent/subscription fallback. A lost chargeback emits no `charge.refunded`,
  so without this a charged-back lifetime key would stay active forever.
- **Dunning must end in cancellation.** `customer.subscription.deleted` (our yearly-lapse signal)
  only fires when Stripe's post-retry action is *cancel*. `beans stripe connect` verifies/documents
  that setting, and as belt-and-braces `customer.subscription.updated` with `status: "unpaid"` is
  also treated as a lapse (disable, `reason=subscription_canceled`), since yearly `expires_at` is
  advisory and never enforced client-side.
- **Quantity is 1.** Created prices/checkout links disable adjustable quantity; one checkout
  session issues exactly one key.

### PayPal (second provider)

A parallel adapter with the same shape: an order/subscription webhook (signature-verified) maps
`checkout completed → ensureLicense`, `refund → disable`, `subscription cancelled → disable`. Purchases
record `provider = 'paypal'` and the PayPal ids. The issuance core is shared; only the adapter differs.

### Idempotency, two layers

`INSERT OR IGNORE INTO provider_events` (skip a redelivered event id) and
`purchases.provider_checkout_id UNIQUE` (issuance can never double-fire, even across the success-page
race in §14). If the key email fails, return `500` with `email_sent_at` still NULL so the provider's
retry re-enters the idempotent path and only the email is retried.

### Purchase lookup — `GET /v1/purchase/session/:checkout_session_id`

Product-token authed. A landing site's success page calls this right after redirect to fetch (or
ensure, via the same idempotent path) the key for that session. Returns the license object + buyer
email, or `404` if the session is unknown/unpaid.

---

## 14. Key delivery

Two channels, both fed by the one idempotent issuance path — no race, no "check back later" state.

- **Success page** (on the host product's landing site, not in Cool Beans). The Stripe/PayPal redirect
  hits `…/thanks?session_id={CHECKOUT_SESSION_ID}`. The page server-side retrieves the session with a
  restricted key, confirms it's paid, calls the purchase-lookup endpoint, and renders the key with a
  copy button plus "we also emailed it to you." Whichever of {webhook, success page} runs first issues;
  the other reads.
- **Email.** A pluggable sender: **Resend** (a plain `fetch`, works natively on Workers) for the cloud;
  an **SMTP** adapter for self-hosters. Sent from the product's `email_from`. Body: the key, activation
  instructions, a download link; for yearly, the renewal date and a customer-portal link. Sets
  `email_sent_at` on success.

---

## 15. Customer portal

A hosted self-service page (cloud) / bundled route (self-host) where a buyer enters their key or email
and can: see their license (status, tier, renewal date), see and **deactivate their activations** to
free a seat, download the app, and reach the Stripe/PayPal billing portal to manage or cancel the
subscription. This is what keeps support out of the seat-management loop.

---

## 16. Admin API, dashboard & audit

Bearer-token authed (global admin token, or per-product token). **CLI-first (`beans …`) plus a web
dashboard.**

- Create/update a product (slug, prefix, activation limit + model, email-from, Stripe/PayPal price ids,
  metrics). Slug and key prefix are immutable after creation — issued keys embed the prefix and clients
  match on the slug. Prefixes are 2–12 letters, matching the public format gate.
- Issue a key manually for a product + email (reissues, comps, testing).
- Disable a key (`reason=manual`) and re-enable one.
- List a product's keys; list a key's activations & usage; look up a purchase by email or provider id.
- **Dashboard** (served by the same app): products, plans, customers, licenses, activations, usage,
  webhooks, audit log, team, email templates, with search, filters, and CSV/JSON export.
- **Audit log**: every state change (`license.issued`, `license.disabled`, `product.updated`, …) with
  actor (`stripe:evt_…`, `admin:<token-name>`, `system`), timestamp, and JSON detail. `provider_events`
  doubles as the payment audit trail.

---

## 17. Data model

Portable SQL (SQLite and, with trivial type edits, Postgres). Extends the original core with
metering, floating leases, offline signing keys, PayPal, and audit.

```sql
CREATE TABLE products (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,          -- 'clementine'
  name              TEXT NOT NULL,
  key_prefix        TEXT NOT NULL UNIQUE,          -- 'CLEM'
  activation_limit  INTEGER NOT NULL DEFAULT 3,
  activation_model  TEXT NOT NULL DEFAULT 'node_locked'
                      CHECK (activation_model IN ('node_locked','floating')),
  email_from        TEXT NOT NULL,                 -- 'Clementine <receipts@clementine.email>'
  stripe_price_lifetime TEXT,
  stripe_price_yearly   TEXT,
  paypal_plan_yearly    TEXT,
  paypal_sku_lifetime   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchases (
  id                    INTEGER PRIMARY KEY,
  product_id            INTEGER NOT NULL REFERENCES products(id),
  provider              TEXT NOT NULL DEFAULT 'stripe',   -- 'stripe' | 'paypal' | 'manual'
  provider_checkout_id  TEXT UNIQUE,                      -- idempotency anchor; NULL for manual
  provider_customer_id      TEXT,
  provider_subscription_id  TEXT,
  provider_payment_id       TEXT,
  email                 TEXT NOT NULL,
  amount_total          INTEGER,
  currency              TEXT,
  note                  TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_purchases_subscription ON purchases(provider_subscription_id);
CREATE INDEX idx_purchases_payment      ON purchases(provider_payment_id);

CREATE TABLE licenses (
  id              INTEGER PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id),
  key             TEXT NOT NULL UNIQUE,          -- normalized, no dashes, uppercased
  tier            TEXT NOT NULL CHECK (tier IN ('lifetime','yearly','trial')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  expires_at      TEXT,                          -- yearly: period_end (advisory); trial: enforced; lifetime: NULL
  disabled_at     TEXT,
  disabled_reason TEXT,                          -- 'refund' | 'subscription_canceled' | 'manual' | 'trial_expired' | 'chargeback'
  email_sent_at   TEXT,                          -- NULL lets webhook retries resend the key
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activations (
  id                INTEGER PRIMARY KEY,          -- (uuid instance id exposed to clients)
  instance_id       TEXT NOT NULL UNIQUE,
  license_id        INTEGER NOT NULL REFERENCES licenses(id),
  name              TEXT NOT NULL,                -- device name the client sent
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_validated_at TEXT,
  lease_expires_at  TEXT,                         -- floating only; NULL for node-locked
  deactivated_at    TEXT                          -- soft delete; NULL = seat in use
);
CREATE INDEX idx_activations_live ON activations(license_id) WHERE deactivated_at IS NULL;

CREATE TABLE metrics (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  key           TEXT NOT NULL,                    -- 'api_calls'
  display_name  TEXT NOT NULL,
  default_limit INTEGER,
  reset_period  TEXT,                             -- 'daily' | 'monthly' | NULL
  UNIQUE(product_id, key)
);

CREATE TABLE usage_counters (
  id            INTEGER PRIMARY KEY,
  license_id    INTEGER NOT NULL REFERENCES licenses(id),
  metric_id     INTEGER NOT NULL REFERENCES metrics(id),
  current       INTEGER NOT NULL DEFAULT 0,
  limit_override INTEGER,
  period_start  TEXT NOT NULL DEFAULT (datetime('now')),
  resets_at     TEXT,
  UNIQUE(license_id, metric_id)
);

CREATE TABLE signing_keys (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER REFERENCES products(id),    -- NULL = global
  algorithm   TEXT NOT NULL DEFAULT 'ed25519',
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,                       -- encrypted at rest
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE provider_events (                     -- webhook redelivery dedupe (Stripe + PayPal)
  id          TEXT PRIMARY KEY,                    -- provider event id
  provider    TEXT NOT NULL,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER,
  actor       TEXT,                                -- 'stripe:evt_…' | 'admin:<token>' | 'system'
  action      TEXT NOT NULL,                       -- 'license.issued' | 'license.disabled' | …
  license_id  INTEGER,
  detail      TEXT,                                -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Trial expiry is enforced lazily at `validate`/`verify` (a trial past `expires_at` is treated as
`disabled`, `reason=trial_expired`) and swept periodically; lifetime/yearly `expires_at` stays advisory
per §9.

---

## 18. Deployment

### Self-host

`docker compose up`: the service plus SQLite (or point `DATABASE_URL` at Postgres). Migrations run on
boot. Env:

- `DATABASE_URL` (or a SQLite file path)
- `STRIPE_SECRET_KEY` (restricted: Checkout Sessions read, Subscriptions read), `STRIPE_WEBHOOK_SECRET`
- `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` / `PAYPAL_WEBHOOK_ID` (if using PayPal)
- `EMAIL_PROVIDER` + its key (`RESEND_API_KEY`, or SMTP host/user/pass)
- `SIGNING_KEY_SECRET` (encrypts signing private keys at rest)
- `ADMIN_TOKEN`

### Cloud (Goldenberry's instance)

Runs on Goldenberry's k8s infrastructure at `app.coolbeans.tools`: Docker images built in CI, pushed
to GHCR, rolled out via the GitOps infra repo (the same pipeline as pleasehold). Postgres + Redis
alongside. Secrets via the deployment env. Rate limiting of 30 req/min/IP on `/v1/*` enforced by the
Redis-backed middleware (the webhook path excluded — it's protected by signature verification
instead).

---

## 19. Security

- Public endpoints: uniform error shapes, format check before any storage hit, 78-bit keys → no
  enumeration oracle beyond the unavoidable key-validity signal.
- Webhooks: signature verification is mandatory; reject unverified bodies before parsing.
- Admin: bearer token, constant-time compare, never logged.
- Offline tokens: Ed25519, private keys encrypted at rest, public keys embeddable, rotation supported.
- Cool Beans holds Stripe/PayPal/email/signing secrets; **clients hold none.**
- `provider_events` + `audit_log` are the audit trail.

---

## 20. Testing

- **Unit/integration (vitest):** key generation & normalization; the full activate/validate/deactivate
  policy (seat limit, disabled-fails-closed, unknown-key-is-404-not-disabled, idempotent deactivate);
  floating lease expiry & heartbeat; metering atomicity under concurrency; offline-token sign/verify &
  rotation; webhook signature rejection & event idempotency (Stripe + PayPal); the lapse-to-disable and
  trial-expiry flows end to end.
- **Docker Compose smoke-boot test**, so the self-host promise is verified, not aspirational.
- **Provider CLIs:** `stripe trigger checkout.session.completed | charge.refunded |
  customer.subscription.deleted` (and the PayPal equivalents) against a local webhook.

---

## 21. Success metrics

- Self-host: GitHub stars/forks, `docker compose up` → first issued key in < 10 min (measured in docs
  walkthrough), self-host smoke test green on every release.
- Cloud: products onboarded, keys issued, activations, paid conversions to Cloud Pro.
- Integration DX: time-to-first-validate with the SDK (target < 5 min from `npm i`), and a working
  Electron + Tauri + Node quickstart shipping in the docs.
- Migration: Clementine fully cut over from Lemon Squeezy with no client-visible regressions.

---

## 22. Suggested build order

1. **Scaffold:** Hono app, storage adapter (SQLite first), migrations, config/env, health check.
2. **Key generation + normalization**, with tests.
3. **Public API:** activate, validate, deactivate (+ policy tests). Independently demoable against
   admin-issued keys.
4. **Offline tokens + `@coolbeans/sdk`** (Node/Electron/Tauri/browser) — the integration pillar.
5. **Admin API + CLI:** product CRUD, manual issue, disable/enable, listing.
6. **Stripe webhook + `ensureLicenseForSession` + idempotency**, tested with the Stripe CLI.
7. **Purchase-lookup + email sender (Resend first).**
8. **Floating leases + heartbeat; usage metering.**
9. **PayPal adapter.**
10. **Customer portal + admin dashboard.**
11. **Packaging:** Dockerfile + compose (self-host), CI images + GitOps rollout (cloud), README for
    both, compose smoke test.

§9's client contract is **frozen first** — products build against it and it must not drift.

---

## 23. Risks & open questions

- **"Why not just use Keygen CE?"** — answer it on the homepage: smaller, MIT (no Fair Source strings),
  self-host-in-minutes, LS-parity drop-in, flat pricing.
- **Keyforge owns the hosted "no-backend Stripe→keys" narrative.** Our counter is self-host + OSS +
  own-your-data.
- **Commoditization** (a 2026 wave of entrants). Tie-breaker is DX, docs, and the clean drop-in path —
  not feature count.
- **Scope creep.** Metering/floating/PayPal/portal/dashboard are in v1 to match keygate; keep each
  minimal and resist entitlement-graph/feature-flag territory (a non-goal).
- **Open questions:** Do we ship native SDK stubs (Swift/C#/C++) in v1 or fast-follow? Is Cloud Free
  one product or two? Lifetime price on cloud is intentionally omitted (self-host is the "own it"
  option) — confirm.

---

## 24. Naming note

Working name **Cool Beans** on `coolbeans.tools` (chosen after wide exploration; the short `.com`/`.dev`
for essentially every good access-word is already registered — `.tools` is purpose-fit for a developer
tool and pairs cleanly with the `@coolbeans` npm scope and GitHub org). The name reads as "you're all
set / your licence is good," which is exactly what a valid check returns — approval, not payment. It is
a working name and can be swapped with a single find-and-replace (`Cool Beans` → name; `coolbeans` →
slug; `@coolbeans` → npm scope; `beans` → CLI) if a better one clears.

Runners-up held in reserve: **Golden Ticket** (warm, on-brand with Goldenberry; needs a domain variant
like `goldticket.dev`), **Latchstring**, **Placet**, **Postern**.
