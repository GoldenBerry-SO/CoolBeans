---
layout: ../../layouts/DocsLayout.astro
title: HTTP API
description: The frozen public client contract, for apps in languages we don't ship an SDK for.
---

**If you're using the [TypeScript SDK](/docs/sdk-typescript) or the [Swift SDK](/docs/sdk-swift),
skip this page.** It's here for languages we don't ship an SDK for. Wiring these up by hand means
re-deciding everything `open()` decides, which is exactly where lockouts come from.

All JSON. Every response body carries `ok`, except the Lemon Squeezy compatibility routes, which
reproduce the LS shape exactly and therefore omit it.

## Three rules you cannot get wrong

**An unknown key returns `404`, never `disabled`.** A data gap or a not-yet-imported key must never
be read as revocation, or an offline machine would lock out on its next revalidation.

**Only an explicit `disabled` revokes access.** A network failure, a timeout, a 5xx, a 404, an
answer about a different product: all inconclusive. Keep the last known-good state.

**The licence key is the only credential.** Public endpoints carry no service secret. The product is
resolved from the key's prefix. Don't put a service secret in an app.

## The `license` object

Identical wherever it appears:

```json
{ "key": "CLEM-A2B3-C4D5-E6F7-H8JK", "status": "active", "kind": "subscription",
  "plan": "Pro yearly", "product": "clementine", "expires_at": "2027-07-17T09:14:00Z" }
```

`status` is `active` or `disabled`. `kind` is `perpetual`, `subscription` or `trial`. `plan` is a
free-form vendor label or `null`, display only, never an authorization input. `product` is the slug.
`expires_at` is ISO 8601 or `null` for perpetual; it's advisory for a subscription (a renewal date,
never enforced on the client's own clock) and **enforced only for `trial`**.

Errors are `{ "ok": false, "error": "<code>", "message": "<human sentence>" }`.

## `POST /v1/activate`

```json
{ "license_key": "CLEM-…", "instance_name": "Chris's MacBook Pro" }
```

- `200` `{ "ok": true, "license": {…}, "instance": { "id": "<uuid>", "name": "…" } }`
- `422 invalid_key`: fails the format check
- `404 unknown_key`
- `403 license_disabled`: fail closed
- `409 activation_limit_reached`: the message names the limit

Reactivating the same device reuses its instance rather than burning a seat.

`instance_name` is what the vendor sees for this seat. A hostname often carries a person's name, so
send something the user would expect to share.

## `POST /v1/validate`

```json
{ "license_key": "CLEM-…", "instance_id": "<uuid>" }
```

- A **known** key always returns `200`, including a disabled one, so the client sees the definitive
  signal: `{ "ok": true, "valid": false, "license": { "status": "disabled", … }, "instance": null }`
- Active key with a live instance:
  `{ "ok": true, "valid": true, "license": {…}, "instance": {…}, "token": "<offline-token>" }`
- Active key but an unknown or deactivated instance: `valid: false` with `license.status: "active"`.
  A client does **not** downgrade on this. Only `disabled` downgrades.
- `404 unknown_key` / `422 invalid_key`: inconclusive, never a lockout.

`token` is the signed offline credential. Cache it. See [Offline](/docs/offline).

## `POST /v1/deactivate`

```json
{ "license_key": "CLEM-…", "instance_id": "<uuid>" }
```

`200 { "ok": true }`. Idempotent: an already-deactivated or unknown instance still returns `ok`.
Frees the seat.

## `POST /v1/heartbeat`

For floating (concurrent) products only.

```json
{ "license_key": "CLEM-…", "instance_id": "<uuid>" }
```

`200 { "ok": true, "lease_expires_at": "…" }`. Renews a floating lease, keeping the seat held. An
expired lease frees the seat automatically, so a crashed client never permanently consumes one.

`lease_expires_at` is `null` when nothing was renewed: an unknown or deactivated instance, a lapsed
lease with no free seat, or a node-locked product. That's how a client tells "lease held" from
"re-activate before continuing". Node-locked products can ignore this endpoint.

## `POST /v1/keyset`

```json
{ "license_key": "CLEM-…" }
```

`200 { "ok": true, "algorithm": "ed25519", "keys": { "<kid>": "<base64>" } }`

The signing keys for whatever product that licence belongs to, so an app can verify a token offline
without being told a product slug. It holds a key, not a slug.

POST rather than GET because the key is the credential and a URL lands in access logs and browser
history. The keys it returns are public. An unknown key is refused exactly as everywhere else,
without confirming whether some product exists behind it.

## `GET /v1/pubkey?product=<slug>`

`200 { "ok": true, "algorithm": "ed25519", "keys": { "<kid>": "<base64>" } }`

The same keys, by slug, for integrations that have a slug and no key.

## Usage metering

### `POST /v1/usage/increment`

```json
{ "license_key": "…", "instance_id": "…", "metric": "api_calls", "delta": 1 }
```

`200 { "ok": true, "current": 9847, "limit": 10000, "resets_at": "…" }`. Enforced atomically.
Over-limit returns `429 quota_exceeded` with the same body shape.

Metering is bound to a live seat: `instance_id` must name an activation on this licence that hasn't
been deactivated, otherwise `404 unknown_instance`. Deactivating a device therefore stops its
metering along with its seat, and unknown and deactivated instances answer identically, so the
endpoint never confirms an instance id once existed.

A lapsed floating lease is deliberately not rejected. That seat frees itself without telling the
client, and failing a running client's metering mid-session would be a surprise.

### `GET /v1/usage?license_key=…`

```json
{ "ok": true, "usage": [ { "metric": "api_calls", "current": 9847, "limit": 10000, "resets_at": "…" } ] }
```

`limit` is `null` when the metric has no cap.

## Customer portal

Key-authed self-service, no login.

### `POST /v1/portal/lookup`

```json
{ "license_key": "CLEM-…" }
```

Returns `{ ok, license, download_url, activations: [ { instance_id, name, created_at,
last_validated_at } ] }`. The live devices holding a seat, so a buyer can free one themselves.

### `POST /v1/portal/recover`

```json
{ "email": "buyer@example.com" }
```

Returns `{ ok: true, message: "If we have licenses for that email, they are on their way." }`.

The keys are **emailed, never returned**. An email address isn't a credential, so answering directly
would hand anyone who knows a buyer's address their licences. The response is identical either way,
so this can't be used to probe who bought what.

### `POST /v1/portal/billing-session`

```json
{ "license_key": "CLEM-…", "return_url": "https://example.com/account" }
```

Returns `{ ok: true, url }`, a provider billing-portal URL so a subscriber can manage or cancel.
`404 no_billing_account` when there's no subscription to manage, which is the honest answer for a
lifetime or manually issued key.

## Interactive reference

Any instance serves the full OpenAPI reference at **`/docs`**, generated from the routes themselves.

For a coding agent, `GET /v1/llms.txt` is the complete integration guide as markdown, and
`GET /v1/integration/<slug>` is your product's brief with its real base URL, slug, key prefix, seat
model and embedded public keys.
