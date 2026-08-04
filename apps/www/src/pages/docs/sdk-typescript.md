---
layout: ../../layouts/DocsLayout.astro
title: TypeScript SDK
description: One open() call for Node, Electron, Tauri and the browser, with offline verification built in.
---

Licence checks for Node, Electron, Tauri and the browser. No service secret in the client, the key
is the credential. Zero dependencies; Ed25519 verification uses WebCrypto.

## Installing

**`@coolbeans/sdk` is not on npm yet** (publishing is tracked in [#123](https://github.com/GoldenBerry-SO/coolbeans/issues/123)). Until it lands, don't run
`npm i @coolbeans/sdk`, it won't resolve. Use it from the repo instead, either way works:

**In a pnpm workspace**, add the package as a workspace dependency:

```json
{
  "dependencies": {
    "@coolbeans/sdk": "workspace:*"
  }
}
```

**Or vendor it.** Copy `packages/sdk` into your project and build it. It has **zero runtime
dependencies**, so there's nothing to bring along with it:

```sh
cd packages/sdk && pnpm build
```

## The whole integration

```ts
import { CoolBeans } from '@coolbeans/sdk';

const cb = new CoolBeans({
  publicKeys: { '1': 'BASE64_PUBLIC_KEY' }, // bundle these in your app
  // product: 'clementine',  // required only if you sell more than one product, see below
});

// On launch, and again whenever the user pastes a key. This is the whole integration.
const state = await cb.open(licenseKey, {
  onChange: (next) => setLicensed(next.decision === 'allow'),
});
if (state.decision === 'deny') lockOut(state);

// On sign-out, to give the seat back
await cb.release();

// On shutdown
cb.stop();
```

### Do you need `product`?

Only if you sell more than one product from one Cool Beans account. Without it the first licence an
install activates binds the app to that product, and every later key is checked against it. But that
first key is the one nobody checked, so a customer holding a licence for your other app could paste
it into a fresh install and unlock this one. Pass the slug and a licence for anything else is
refused outright.

A wrong slug in your build can't lock anybody out, it just never unlocks: while the app is running,
an answer about another product stays inconclusive.

## The verdict

```ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null }
{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null }
```

Branch on `decision`. Nothing else. `reason` is for what you say to the user: `grace` means nudge
them online, `uninitialized` means ask for a key, `revoked` means the licence is gone.

It's a union rather than a boolean on purpose. "We have never established an entitlement" and
"you were revoked" both mean locked, but they're different screens, and a boolean loses that.

`license` is the frozen §9 object, read off the cached token, so showing "Pro monthly, renews 12
Aug" costs no extra call. It's display only, never gate a feature on `plan` or `kind`. `expiresAt`
is the same value as `license.expires_at`, lifted out for convenience.

## Gating features: `state.entitlements`

When a vendor prices capabilities, they arrive here, and this is the only thing to gate on:

```ts
if (state.entitlements?.export_4k) enableExport4k();
const batchLimit = Number(state.entitlements?.batch_limit ?? 1);
```

The field is absent when a licence has none, so keep the `?.`. Values are booleans, numbers or
strings, never nested, so `Number(x ?? 1)` and `=== true` are safe.

`entitlements` is top-level, not inside `license`. It's present on a `deny` too, since it comes off
the same token, but gate on it only when the decision is `allow`, or you're handing capabilities to
somebody whose licence just ended.

These are server-authored and signed into the token, which is what makes them safe in client code.
`license.plan` is a label a vendor types and `license.kind` is our lifecycle bookkeeping: both are
display only. `if (plan === 'Pro')` breaks the day somebody renames a tier.

The capability names are the vendor's own invention. There's no catalog, and an absent name simply
reads as off with nothing anywhere reporting it, so don't guess one. Your product's
`/v1/integration/<slug>` brief lists the names its prices actually grant.

## What `open()` does for you

**Activates on first run, validates after that.** No instance id to hold, no branch to get wrong.

**Refreshes on its own**, at a third of the token's lifetime, jittered so every install of your app
doesn't wake on the same tick and stampede one server. A changed verdict arrives via `onChange`; it
doesn't fire while the answer stays the same, so it's safe to re-render from it.

**Holds a floating seat itself.** It heartbeats once, reads the lease window off the response, and
keeps to about a third of it, so one dropped request doesn't cost the user their seat. A node-locked
product returns no lease and nothing more is scheduled. Your app doesn't know or care which kind it
is.

**Never locks out on an inconclusive answer.** Offline, a 5xx, a timeout, an unknown key: all of it
keeps the last known-good state. Only a fetched `disabled` or a signed expiry in the past denies.

**Cannot be extended by moving the clock back.** A wall-clock floor is persisted alongside the token
and expiry is judged against it. A successful validation resets the floor, so a briefly wrong clock
isn't a life sentence.

**Doesn't keep a CLI alive.** The background timers are unref'd, so a tool that opens, prints and
exits, exits.

### Anti-patterns

**Don't check on every feature use or window focus.** That's what the cached token is for, and it
turns a momentary network blip into visible flakiness.

**Don't treat a failed check as a reason to do anything abrupt.** A failure is the inconclusive
case. `open()` already resolves it to the last good state, and nothing in the background throws into
your app.

**Don't reach for `verify` / `verifyOffline` first.** They still work, and `open()` is built from
them, but every lockout bug we've seen came from an app wiring those two together itself.

**Don't build a seat policy.** Seats are enforced on the server and are deliberately not on the
verdict: running out reaches you as a `deny` you already handle. Capabilities are the one thing that
varies per licence, and they come from `state.entitlements`.

## Storage

**Required outside the browser, and the SDK throws at construction without it.** In-memory storage
mints a new device id every launch, so every launch takes another activation and a node-locked
licence is spent in a handful of restarts, on a customer who paid. The browser gets `localStorage`.

```ts
const cb = new CoolBeans({ product: 'clementine', storage: myFileBackedStore });
```

Two synchronous methods, `getItem(key)` and `setItem(key, value)`. Back it with a file in the user's
profile, `electron-store`, the Tauri store plugin, the Keychain, anything that survives a restart.
`allowEphemeralStorage: true` opts out, for tests and throwaway scripts only.

A file-backed store for Node, Electron or Tauri is about ten lines:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function fileStorage(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const read = (): Record<string, string> => {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
  };
  return {
    getItem: (k: string) => read()[k] ?? null,
    setItem: (k: string, v: string) => {
      writeFileSync(path, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 });
    },
  };
}
```

## Offline behaviour

Three rules are worth knowing because they carry product decisions:

**A network failure never locks anyone out.** Grace past the token TTL is unbounded for paid tiers.
That's the offline-tolerant contract, and it's why an app on a plane keeps working.

**A signed `expires_at` in the past ends access, for every tier.** The token states the licence
ended, so honouring it is reading the credential rather than guessing from a failed request. The
server issues that date with a buffer, so a subscriber who renews while offline has room to
reconnect.

**Trials get no grace at all**, or blocking the endpoint would be an unlimited trial.

`open()` already applies all three. If you want to see them directly, `offlineState()` is
network-free and returns `valid` (inside the token's TTL), `grace` (past it, licence still good,
and **still unlocked**) or `expired`. `verifyOffline()` is the boolean form. Neither is the path to
build on. See [Offline verification](/docs/offline) for the full model.

## The surface

Four calls, and you'll use two of them:

- **`open(licenseKey?)`**: the verdict. On launch, and again when a key is pasted. The key is
  optional after the first call: it's stored for you, so `open()` with no argument is exactly
  `open(undefined)`.
- **`release()`**: frees this device's seat, forgets the licence, and ends the background refresh.
  On sign-out. Returns false when it couldn't reach us, and then **nothing was cleared**, so the
  retry still has what it needs and the seat is genuinely still held. After a true,
  `open(newKey)` starts again from scratch.
- **`stop()`**: ends the background refresh. On app shutdown. Synchronous, nothing to await.
- **`importActivation(blob)`**: unlocks a machine that will never reach the network, from a
  vendor-issued signed blob. Only if the vendor offers that. See [Offline](/docs/offline).
- **`activate(licenseKey)`**: for a **key-entry form only**, when you want to tell the user *why* a
  key was refused. `open()` deliberately swallows that, because an unknown key is inconclusive and
  must never read as a revocation, which leaves you unable to say "we could not verify that key".
  `activate` throws a `CoolBeansError` with an error code you can show. Follow it with `open()`;
  never gate the app on its result.

There are lower-level calls (`verify`, `verifyOffline`, `offlineState`, `heartbeat`, `deactivate`,
`fingerprint`, `instanceId`). You don't need them, and every lockout bug we've seen came from wiring
them together by hand.

## Public keys

`publicKeys: {}` is fine. The SDK fetches the signing keys by licence key on the first `open()` and
caches them, and offline-before-that is `uninitialized`, never a wrong unlock. Bundling them just
means the first offline check needs no network call. Keys fetched later are merged with the
embedded ones, so a server-side rotation doesn't need an app release.

## Errors

Server errors throw `CoolBeansError` carrying the HTTP status and the machine-readable code, so you
can branch on `unknown_key` versus `license_disabled` rather than parsing prose.
