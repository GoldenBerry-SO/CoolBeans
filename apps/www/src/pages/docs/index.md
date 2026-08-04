---
layout: ../../layouts/DocsLayout.astro
title: What Cool Beans is
description: A small open-source service that issues software licence keys, activates them on devices, and tells your app whether a key is still good.
---

Cool Beans is a small MIT-licensed service that issues and validates software licence keys and
turns Stripe and PayPal payment events into licence state. A customer buys, gets a key, activates
it on their machines, and Cool Beans is the source of truth for whether that key is still good.

Issue a key, activate it, check it's still good. That's the whole product.

## The mental model

```
key  ->  activate (takes a seat)  ->  validate (returns a signed offline token)
                                          |
                                          v
                              your app branches on state.decision
```

- **Keys** are issued on purchase, or by hand from the console or the CLI. There's no per-user
  login and no OAuth.
- **Activate** binds a key to a device and consumes a seat. The activation limit is enforced
  server-side, so your app never counts seats.
- **Validate** confirms the key and hands back an Ed25519-signed offline token. The SDK caches it
  and can verify it later with no network at all.
- **Your app** makes one call on launch and gets one verdict back.

## The one rule that matters

Access is refused only on a *definitive* answer. The SDK already sorts the definitive from the
inconclusive, so in your code the rule is simply: **branch on `state.decision`, and nothing else.**

What that resolves for you:

- **Disabled licence** gives `deny`, reason `revoked`. This is the only signal that takes access
  away.
- **A signed expiry that has passed** gives `deny`, reason `expired`. Our own credential saying the
  licence ended, which is how a lapsed subscription reaches a machine that has gone dark.
- **Never activated on this device** gives `deny`, reason `uninitialized`. Ask for a key. This is
  not a revocation, so don't phrase it as one.
- **Network failure, a timeout, a 404, a 5xx, an answer about a different product** all give
  **`allow`**, on the last known-good state. Every one of these is inconclusive. **Never lock a
  user out on an inconclusive answer.** The SDK doesn't, and neither should anything you add.

Don't add your own checks on top. Don't compare dates, inspect `license.status`, or decide what a
failed request meant. That's the whole job of `open()`, and every lockout we've seen came from an
app second-guessing it.

## The verdict

```ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null,
  entitlements?: Record<string, boolean | number | string> }

{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null,
  entitlements?: Record<string, boolean | number | string> }
```

It's a union rather than a boolean on purpose. "We have never established an entitlement" and
"you were revoked" both mean locked, but they're different screens, and a boolean loses that.

`reason` is only for what you say to the user:

| Reason | What it means | What to show |
|---|---|---|
| `online` | The server just confirmed it | Nothing |
| `cached` | No fresh answer, cached token still inside its lifetime | Nothing |
| `grace` | Past the token lifetime, licence still good | Nothing loud. Optionally nudge them online |
| `clock_rollback` | Unlocked, but this machine's clock went backwards | Treat like `cached` |
| `uninitialized` | No entitlement has ever been established here | The licence-key form |
| `expired` | The licence ended | Point at renewal |
| `revoked` | The licence was taken away | Point at support |

## Gating features

`license.plan` is a label the vendor types and `license.kind` is our lifecycle bookkeeping. Both
are display only. The only thing to gate a feature on is `state.entitlements`:

```ts
if (state.entitlements?.export_4k) enableExport4k();
const batchLimit = Number(state.entitlements?.batch_limit ?? 1);
```

Entitlements are authored on the server and signed into the token, which is what makes them safe
in client code. `if (plan === 'Pro')` breaks the day somebody renames a tier.

## Design principles

- **Boring and small.** Node and TypeScript on [Hono](https://hono.dev). One codebase serves
  self-host and the hosted cloud.
- **Multi-product and multi-tenant.** An account owns its products and admin users. Self-host stays
  single-account and unlimited.
- **Provider-pluggable payments.** The payment webhook and the issuance core are separated, so a new
  provider is an adapter, not a rewrite.
- **The key is the credential.** Public endpoints authenticate by the key itself. The client carries
  no service secret. Cool Beans holds the Stripe, PayPal and email secrets; clients hold none.
- **Offline-tolerant by contract.** A network failure or inconclusive answer never locks a user out.
  Only an explicit `disabled` signal revokes access.

## Two homes

- **Self-host** on Node with PostgreSQL, free forever, `docker compose up`. See
  [Self-hosting](/docs/self-hosting).
- **Cloud**, the same service run for you, where billing being configured is the only thing that
  makes an instance "cloud".

It's also a drop-in for the Lemon Squeezy License API, so existing clients migrate with a base-URL
change. See [Migrating from LemonSqueezy](/docs/migrate-from-lemonsqueezy).

## Next

- [Quickstart](/docs/quickstart): issue a key and wire up an app in a few minutes.
- [TypeScript SDK](/docs/sdk-typescript) and [Swift SDK](/docs/sdk-swift).
- [HTTP API](/docs/http-api) if there's no SDK for your language.
- [The beans CLI](/docs/cli) for admin from a terminal.
- [Payments](/docs/payments) to turn a Stripe price into a key.
- [Offline verification](/docs/offline) for how an app keeps working with no network.
- [Outbound webhooks](/docs/webhooks) to tell your own systems when a licence changes.
