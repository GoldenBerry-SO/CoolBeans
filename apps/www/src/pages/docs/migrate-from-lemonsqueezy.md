---
layout: ../../layouts/DocsLayout.astro
title: Migrating from LemonSqueezy
description: Parity routes at /v1/licenses/* mean an app built against the LS License API talks to Cool Beans unchanged. Keys are issued fresh; there is no key import.
---

Cool Beans serves alias routes that emulate the Lemon Squeezy License API request and response
contract exactly. An app already built against the LS License API can point at Cool Beans without a
rewrite.

## The routes

```
POST /v1/licenses/activate
POST /v1/licenses/validate
POST /v1/licenses/deactivate
```

Same paths LS uses, same shapes. Change the base URL and the client code is done.

## Keys already out in the wild

The parity is at the API level, not the key level. Cool Beans resolves keys from its own database,
and **there is no import route today**, so a key Lemon Squeezy issued answers `404 unknown_key`
here. To an offline-tolerant client that's inconclusive, never a lockout, but it also never
validates.

Migrating existing customers therefore means issuing them Cool Beans keys. `beans key issue` (or
`POST /admin/keys`) issues one and emails it to the buyer in the same call, and the
`--json` flag makes it scriptable over an exported LS customer list. The practical path: keep LS
answering old keys while it winds down, issue Cool Beans keys to those buyers, and ship the
base-URL change in the release that expects them. New sales issue Cool Beans keys from day one via
[Payments](/docs/payments).

Both JSON and form-encoded bodies are accepted, the way LS accepts them.

These are a serializer over the same handlers the native `/v1/*` routes use, not a second
implementation, and a parity test suite pins both. The native routes carry the clean contract; these
carry the LS shape.

## The shapes

Unlike the native `/v1/*` endpoints, these bodies carry **no `ok` field**. That's deliberate: they
reproduce the LS response exactly.

### `POST /v1/licenses/activate`

Request: `license_key`, `instance_name`.

```json
{
  "activated": true,
  "error": null,
  "license_key": {
    "id": 1234,
    "status": "active",
    "key": "CLEM-A2B3-C4D5-E6F7-H8JK",
    "activation_limit": 3,
    "activation_usage": 1,
    "created_at": "...",
    "expires_at": null
  },
  "instance": { "id": "<uuid>", "name": "Chris's MacBook Pro", "created_at": "..." },
  "meta": {
    "store_id": null,
    "product_id": 42,
    "product_name": "Clementine",
    "customer_name": null,
    "customer_email": null
  }
}
```

On failure, `activated` is `false` and `error` carries a human message. **The `license_key` object
is still returned whenever we know the key**, because LS does that too and a migrating client reads
status off it. For an unknown or malformed key, `license_key` and `meta` stay `null`, so nothing
leaks about keys that aren't ours.

### `POST /v1/licenses/validate`

Request: `license_key`, and optionally `instance_id`.

Returns `valid`, `error`, `license_key`, `instance`, `meta`.

LS semantics on the instance: **without an `instance_id`, the key alone is validated** and
`instance` comes back `null`. With one, the instance is checked too and `error` reads
"License is not valid for this instance." when it doesn't match.

### `POST /v1/licenses/deactivate`

Request: `license_key`, `instance_id`.

Returns `deactivated`, `error`, `license_key`, `meta`.

## Status mapping

The LS `status` field has a value we don't: `expired`. The mapping is:

| Cool Beans | LS `license_key.status` |
|---|---|
| `active` | `active` |
| `disabled` | `disabled` |
| `disabled` because a trial ran out | `expired` |

`activation_limit` is the product's limit and `activation_usage` is the live seat count, which for a
floating product counts only activations whose lease hasn't lapsed.

## Status codes

LS returns `400` for most licence errors, and so do these routes. An unknown key keeps `404`.

## What you keep from the native contract

The alias routes are a compatibility layer, not the destination. Everything else on the service is
still there and still better:

- The frozen native contract at [`/v1/*`](/docs/http-api), where every body carries `ok` and an
  unknown key is unambiguously a 404.
- **Signed offline tokens** on `validate`, so an app keeps working with no network. See
  [Offline](/docs/offline).
- The [TypeScript](/docs/sdk-typescript) and [Swift](/docs/sdk-swift) SDKs, where the whole
  integration is one `open()` call.

If you're migrating an app you also control, the alias routes get you running today and the SDK is
the thing to move to next. The request and response shapes match closely enough that the client
changes are minimal.
