---
layout: ../../layouts/DocsLayout.astro
title: Payments
description: Prices live in Stripe, a grant maps one price to what the buyer gets, and a webhook turns a payment into a key.
---

Onboarding a product is two things: map your existing Stripe prices to the product with licence
grants, then point one webhook per Stripe connection at the service. For Stripe we automate the
webhook creation, so it's genuinely a five-minute job.

## Pricing lives in Stripe

Cool Beans never stores the amount, currency, interval, or product name. A grant records only the
price id, the licence kind it issues, and an optional display-only plan label. You price however you
like in Stripe (monthly, tiers, add-ons) and map the prices here.

## Licence grants

A **licence grant** maps one Stripe price to one product, unique per (connection, price):

```
{ stripe_price_id, kind, plan?, activation_limit?, entitlements? }
```

**The kind is inferred from the price**, so you usually don't state it. A one-time price grants a
`perpetual` licence with no expiry. A recurring price of any cadence grants a `subscription` licence
whose `expires_at` tracks the Stripe period end. If you do state a kind it must still match the
price. A stated wrong intent is refused, never silently corrected, because it usually means the
wrong price id was pasted.

**`plan`** is the vendor's free-form label, like "Pro monthly". It's snapshotted onto every licence
the grant issues, and it's display only, never an authorization input.

**`activation_limit`** is how many seats the price buys. Null inherits the product's limit. The seat
count stays server-side and is enforced there, so an app never counts seats.

**`entitlements`** is a flat map of signed scalars saying which capabilities the price buys, like
`{ export_4k: true, batch_limit: 100 }`. These are signed into the offline token and are the only
thing an app may gate a feature on.

Both the seat count and the entitlements are snapshotted onto the licence at issuance, so re-pricing
a grant never changes what somebody already bought. That's what lets one product sell Basic and Pro
from one binary. Grants are retired, never deleted, so an issued licence always resolves back to the
rule that made it.

Editing a grant to fix a label won't strip its capabilities. Leaving `entitlements` out keeps
whatever the price already grants; an empty map is the only way to say "this price grants none any
more".

## Self-host vs cloud

A **Stripe connection** models the vendor's Stripe account. One abstraction, two modes:

- **Self-host** (`self_host_default`): one connection seeded per instance from the `STRIPE_*`
  credential, shared by every product on the box. You use your own Stripe account directly. The
  webhook signing secret lives on the connection, not the product, so a self-host instance has
  exactly one Stripe webhook endpoint however many products it runs.
- **Cloud** (`cloud_connect`): Stripe Connect, one connection per account. You authorize your own
  Stripe account through Connect, and all your events arrive on one platform endpoint,
  `/v1/connect/stripe/webhook`, keyed by the signed `event.account`.

The three `*STRIPE*` config namespaces are separate on purpose and must never be mixed. See
[Self-hosting](/docs/self-hosting#the-three-stripe-namespaces).

## Wiring the webhook

Either `beans stripe connect --product <slug> --webhook-url <url>` from the CLI, or the console's
**Connect Stripe** action. Both auto-register the connection's webhook endpoint through the Stripe
API and store the signing secret. Registration is their whole job. No manual dashboard wiring.

Then map prices: one grant per price, in the console under Stripe prices, or over the admin API.
`GET /admin/products/<slug>/stripe/prices` lists the connected account's active prices with the
facts a human recognizes (names, amounts, cadence, and what each is already mapped to), then create
the grant:

```sh
curl -X POST "$COOLBEANS_URL/admin/products/clementine/grants" \
  -H "Authorization: Bearer $COOLBEANS_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"stripe_price_id":"price_1Qabc...","plan":"Pro yearly"}'
```

`stripe_price_id` is the only required field. `kind`, `plan`, `activation_limit` and `entitlements`
are optional, as described above. (The bearer token is the self-host `ADMIN_TOKEN`; on the hosted
cloud the admin API is session-authed, so use the console there.)

## What the webhook does

`POST /v1/stripe/webhook`, signature-verified with the official Stripe SDK against the raw request
body, using the connection's signing secret.

| Event | Action |
|---|---|
| `checkout.session.completed` | Resolve the product and grant from the session's price id, insert the purchase, issue the key, send the key email. |
| `charge.refunded` | Disable the key, `reason=refund`. Only a full refund disables; a partial refund is recorded in the audit log and the licence stays active. |
| `customer.subscription.updated` | Set `expires_at = current_period_end`. Covers renewals and scheduled cancels, where the key stays active and the date stops advancing. |
| `customer.subscription.deleted` | Disable the key, `reason=subscription_canceled`. This is the subscription-lapse enforcement, fired at the end of the paid-through period. |
| `charge.dispute.created` | Disable the key, `reason=chargeback`. A lost chargeback emits no `charge.refunded`, so without this a charged-back perpetual key would stay active forever. |

`checkout.session.async_payment_succeeded` is handled too.

Perpetual keys are never touched by subscription events. They die only on refund or chargeback.

One checkout session issues exactly one key: created prices and checkout links disable adjustable
quantity.

Issuance is idempotent two ways: a `provider_events` table skips a redelivered event id, and
`purchases.provider_checkout_id` is UNIQUE, so issuance can never double-fire even when the success
page and the webhook race each other.

## PayPal

A parallel adapter with the same shape: an order or subscription webhook, signature-verified, maps
checkout completed to issuance, refund to disable, and subscription cancelled to disable. Purchases
record `provider = 'paypal'` and the PayPal ids. The issuance core is shared; only the adapter
differs.

## When a payment matches no mapping

If a paid checkout matches no grant, the money is not lost and it is not silently ignored. It's
recorded as an unfulfilled payment, and the console offers a **one-click rescue** that issues
retroactively once you've mapped the price.

Under the hood the rescue runs exactly the webhook's path. It's idempotent by checkout id, so a
Stripe redelivery racing your rescue still issues exactly one key, and re-rescuing returns the same
licence. If the price still isn't mapped, it tells you so rather than guessing: map the price first,
then rescue again.

The list stays reachable however long it gets, and each row says whether it's since been fulfilled,
whether by your rescue or by Stripe redelivering after the mapping appeared.

## Success pages

`GET /v1/purchase/session/:checkout_session_id`, product-token authed. A landing site's success page
calls this right after redirect to fetch the key for that session. If the webhook hasn't landed yet
it ensures the licence through the same idempotent path, so whichever runs first, exactly one key
exists. Returns the licence object and buyer email, or `404` if the session is unknown or unpaid.
