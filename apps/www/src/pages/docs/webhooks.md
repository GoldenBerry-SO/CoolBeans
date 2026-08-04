---
layout: ../../layouts/DocsLayout.astro
title: Outbound webhooks
description: Cool Beans calls your server when licence lifecycle events happen, signed and retried.
---

Cool Beans can call your server when licence lifecycle events happen. Register an endpoint in the
console (Webhooks, then Your endpoints) or via `POST /admin/webhooks/endpoints`, pick the event
types you care about, and store the signing secret it returns. It's shown exactly once.

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
