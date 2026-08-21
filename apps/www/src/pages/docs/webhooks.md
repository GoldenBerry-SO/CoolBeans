---
layout: ../../layouts/DocsLayout.astro
title: Outbound webhooks
description: Cool Beans calls your server when licence lifecycle events happen, signed and retried.
---

Cool Beans can call your server when licence lifecycle events happen. Register an endpoint in the
console (Webhooks, then Your endpoints), pick the event types you care about, and store the signing
secret it returns. It's shown exactly once.

## One endpoint, or one per product

An endpoint can be scoped to a single product, or left on **all products** to receive events for
everything in the account. Scoping is what lets a vendor selling several apps give each one its own
URL and its own signing secret, so a rotation on one app never touches another.

Leaving it unscoped is the default and is what every endpoint created before scoping existed does,
so nothing changed for them. Note that the `license` object in every payload already carries the
product slug, so you can tell products apart on a shared endpoint too; scoping is about separate
URLs and separate secrets, not about identifying the product.

The same registration over the admin API (self-host, bearer `ADMIN_TOKEN`):

```sh
curl -X POST "$COOLBEANS_URL/admin/webhooks/endpoints" \
  -H "Authorization: Bearer $COOLBEANS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hooks/coolbeans","events":["license.issued","license.disabled"],"product":"clementine"}'
```

`product` is optional: omit it and the endpoint receives events for every product in the account.
A slug that isn't yours answers `404`, the same as everywhere else on the admin surface.

The response carries the endpoint and its signing secret. `GET /admin/webhooks/event-types` lists
the valid event names, `GET /admin/webhooks/endpoints` lists what's registered, and per endpoint
there's `POST /admin/webhooks/endpoints/:id/rotate` (returns the new secret, again exactly once),
`DELETE /admin/webhooks/endpoints/:id`, and `GET /admin/webhooks/endpoints/:id/deliveries` for the
delivery log.

## Events

| Type | Fired when |
| --- | --- |
| `license.issued` | A key is issued (checkout, manual, or CLI) |
| `license.disabled` | A key is revoked; `reason` says why (refund, trial_expired, manual…) |
| `license.reenabled` | A disabled key is restored |
| `license.expiry_extended` | A subscription or trial expiry moved; `previous_expires_at` rides along |
| `activation.created` | A device claimed a seat; `instance` carries its id and name |
| `activation.deactivated` | A seat was freed: manual deactivate, the customer portal, or an expired floating lease (`reason: "lease_expired"`) |

Every payload carries `event` (`type`, `created_at`) and the `license` object exactly as the public
API serializes it: `key`, `status`, `kind`, `plan`, `product`, `expires_at`.

## Delivery contract

- At-least-once. Deliveries retry with backoff (up to 5 attempts), so make your handler idempotent
  on `(event.type, license.key, event.created_at)`.
- A dead receiver never slows or fails issuance. Delivery is asynchronous by design.
- Answer any 2xx quickly and do your work after responding. Anything else counts as a failure and is
  retried.
- The delivery log (console, then Webhooks, then Deliveries) shows status, attempts, and the last
  error per delivery.

## Verifying a delivery

Each request carries:

```
X-CoolBeans-Event: license.issued
X-CoolBeans-Signature: t=1723225200,v1=6f5a…
```

Recompute the signature over the **raw body** and compare in constant time:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret: string, header: string, rawBody: string): boolean {
	const t = Number(header.match(/t=(\d+)/)?.[1]);
	const v1 = header.match(/v1=([0-9a-f]+)/)?.[1];
	if (!Number.isFinite(t) || !v1) return false;
	if (Math.abs(Date.now() / 1000 - t) > 300) return false; // refuse stale timestamps
	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
	const a = Buffer.from(v1, 'hex');
	const b = Buffer.from(expected, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}
```

Rotate the secret from the console at any time. The new value is shown once, and deliveries sign
with it immediately.

## What this is not

The webhook stream is for *your* systems: CRM, analytics, Slack. Your application should keep using
the client SDK contract, so activate, validate, offline tokens, and it should never gate a feature
on webhook arrival.
