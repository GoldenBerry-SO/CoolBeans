---
layout: ../../layouts/DocsLayout.astro
title: Offline verification
description: Signed Ed25519 tokens, the grace model, the offline cutoff, and activating a machine that will never reach the network.
---

An app on a plane keeps working. That's the contract, and this page is how it's kept.

## Signed offline tokens

On a successful `validate`, Cool Beans returns a compact **Ed25519-signed token** (a JWT-style
structure) carrying:

```
{ key, status, kind, plan, product, expires_at, entitlements?, instance_id, iat, exp }
```

It has a short TTL, 7 days by default. The SDK caches it and can verify it **with no network** at
all, against a public key bundled in the app.

- **Online:** the SDK calls `validate` and refreshes the token.
- **Offline or a network error:** the SDK verifies the cached token's signature locally. Still
  within TTL means valid. Past TTL means keep trying online but **stay in a grace state**, never
  hard-lock on a network failure.
- Only an explicit `disabled` result, or a signed "disabled" token, revokes access.

Signing keys are per-product (or global), stored server-side with the private half encrypted at
rest. The public half is what apps embed. Key rotation is supported, so multiple active public keys
are fine, and keys fetched later are merged with the embedded ones.

## The three states

| State | Meaning | In your UI |
|---|---|---|
| `valid` | Verified and inside the token TTL | Unlock, say nothing |
| `grace` | Past the TTL, licence has not expired | **Unlock.** Normal, not an error |
| `expired` | No token, unverifiable, wrong device, disabled, or the licence ended | Lock, ask them to sign in |

`grace` is the one people get wrong. It means "we haven't been able to check for a while", which
happens on a plane. Don't shout about it, and don't put a modal in front of it.

`open()` already applies all of this. `offlineState()` is the network-free way to see it directly,
and `verifyOffline()` is the boolean form. Neither is the path to build on.

## The offline cutoff

Three rules carry the product decisions:

**A network failure never locks anyone out.** Grace past the token TTL is unbounded for paid tiers.
That's the offline-tolerant contract.

**A signed `expires_at` in the past ends access, for every tier.** This is not a lockout on an
inconclusive answer. The token we issued states the licence ended, so honouring it is reading our
own credential rather than guessing from a failed request. It's what makes subscription revocation
reach a machine that has gone offline. Perpetual licences carry no `expires_at` and are unaffected.

**Trials get no grace at all**, or blocking the endpoint would be an unlimited trial. Trials are
also the one kind where `expires_at` is enforced rather than advisory.

### The renewal buffer

The date in the token is the server's choice, not the licence's raw expiry. It carries a buffer
(`OFFLINE_TOKEN_BUFFER_DAYS`, default 14 days) so a subscriber who renews while offline, and is
still holding a token stamped with the old date, has room to reconnect rather than being locked out
of something they paid for.

The policy lives on the server so it can change without an app update. It's never applied to trials,
and never to a perpetual licence, which has no expiry to buffer.

## Clock rollback

Offline expiry reads the system clock, and a user can set it back. A wall-clock floor is persisted
alongside the token and expiry is judged against it, so winding the clock back can't extend a
licence. A successful validation resets the floor, so a briefly wrong clock isn't a life sentence.

A clock that appears to have moved backwards is distrusted, never punished. The verdict is still
`allow`, with reason `clock_rollback` (`.clockRollback` in Swift). A dead CMOS battery or a fresh VM
keeps working. Treat it exactly like `cached`.

## Air-gapped machines

A machine that has never had internet cannot activate at all through the normal flow, because
activation is a round trip. For labs, defence and similar buyers, the vendor mediates instead:

1. The offline machine shows its device fingerprint (`cb.fingerprint()`).
2. The customer sends that to the vendor by any means.
3. The vendor pastes it into the console against a licence and gets back a signed activation blob.
4. The customer carries the blob to the machine and pastes it in.

On the device:

```ts
await cb.importActivation(pastedBlob);
```

```swift
try await cb.importActivation(pastedBlob)
```

The device never makes a request. The seat is consumed through the same guarded statement as an
online activation, so this can't be used to exceed the activation limit, and the operator who issued
it is recorded in the audit log along with the fingerprint.

**The blob is bound to one machine.** It carries a signed `fingerprint` claim and the SDK refuses it
on any other machine, including a blob with no claim at all. Without that check the only
device-specific value in the token would be the `instance_id` the client is about to store from that
same token, so the check would be circular and one blob would unlock every machine it was pasted
into.

**Node-locked products only.** Offline activation refuses a floating product with
`floating_not_supported`. A floating seat is held by a lease the machine renews, and an air-gapped
machine can never heartbeat, so its lease lapses, the server counts the seat free, and the vendor
could issue another blob while every earlier machine stays unlocked for the full TTL. That's an
unbounded number of activations on a one-seat licence, so the refusal is the feature.

**The TTL is long.** `OFFLINE_ACTIVATION_TTL_DAYS` defaults to a year, because the machine can never
refresh, and it's clamped to the licence's own expiry so it can't outlive what was paid for. The
renewal buffer is deliberately **not** applied here: it exists to give a client that can reconnect
room to do so, and an air-gapped machine never will, so buffering it would only let an unreachable
machine outlive the licence.

**Be plain about the tradeoff:** an air-gapped machine cannot be revoked before its token expires.
That's inherent to licensing something we can't reach, not a defect, and the TTL is the dial.

## Where the public key comes from

Copy it out of the console and paste it into your source, or fetch it with
`POST /v1/keyset { license_key }` (by key) or `GET /v1/pubkey?product=<slug>` (by slug).

Embedding it is the point: a machine that has never been online still has something to check a
signature against, and on a notarised app tampering with the bundle breaks the code signature.
Embedded keys are never displaced by fetched ones, because they're the trust anchor that shipped
inside your signed binary.

Leaving `publicKeys` empty is also fine. The SDK fetches them by licence key on the first `open()`
and caches them, and offline-before-that is `uninitialized`, never a wrong unlock.

## Both SDKs agree

`contract/access-states.json` is a shared fixture set that both the TypeScript and Swift SDKs run.
If the two ever disagree about who keeps working, a test fails.
