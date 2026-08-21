# Outbound webhooks

Cool Beans can call your server when licence lifecycle events happen (issue #108). Register
an endpoint in the console (Webhooks → Your endpoints) or via `POST /admin/webhooks/endpoints`,
pick the event types you care about, and store the signing secret it returns. It is shown
exactly once.

## Events

| Type | Fired when |
| --- | --- |
| `license.issued` | A key is issued (checkout, manual, or CLI) |
| `license.disabled` | A key is revoked; `reason` says why (refund, trial_expired, manual…) |
| `license.reenabled` | A disabled key is restored |
| `license.expiry_extended` | A subscription/trial expiry moved; `previous_expires_at` rides along |
| `activation.created` | A device claimed a seat; `instance` carries its id and name |
| `activation.deactivated` | A seat was freed: manual deactivate, the customer portal, or an expired floating lease (`reason: "lease_expired"`) |

Every payload carries `event` (`type`, `created_at`), the `license` object exactly as the
public API serializes it (PRD §9): `key`, `status`, `kind`, `plan`, `product`, `expires_at`,
and `buyer` (`email`).

`buyer` is assembled in the emitter, never in the shared licence serializer: a field added
there would surface on every activate and validate response, which is the drift §9 forbids.

An endpoint can be scoped to one product or left on all of them (`product_id` NULL means
all). The scope is a composite foreign key on `(account_id, product_id)`, so an endpoint
cannot point at another tenant's product.

The published page at `/docs/webhooks` is the fuller version of this, including the https
rule and the retention window. Keep the two in step.

## Delivery contract

- At-least-once. Deliveries retry with backoff (up to 5 attempts); make your handler
  idempotent on `(event.type, license.key, event.created_at)`.
- A dead receiver never slows or fails issuance, and delivery is asynchronous by design.
- Answer any 2xx quickly (do your work after responding). Anything else counts as a failure
  and is retried.
- Redirects are not followed. A 3xx is a failure, because a redirect can move the payload,
  buyer email included, onto plaintext or to an address refused at registration.
- Cloud requires https, since the payload carries an email. Self-host keeps http, where the
  operator owns both ends.
- The delivery log (console, then Webhooks, then Deliveries) shows status, attempts and the
  last error. It never returns the stored body.
- Finished deliveries are pruned 30 days after the event, measured from when it fired, not
  from when delivery settled. Pending rows are never pruned: the stored body is the only
  copy of what a retry owes.

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

Rotate the secret from the console at any time; the new value is shown once, and deliveries
sign with it immediately.

## What this is not

The webhook stream is for *your* systems (CRM, analytics, Slack). Your application should
keep using the client SDK contract, so activate, validate, offline tokens, and never gate a
feature on webhook arrival.
