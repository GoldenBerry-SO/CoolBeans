# @coolbeans/sdk

Licence checks for Node, Electron, Tauri and the browser. No service secret in the client — the key
is the credential. Zero dependencies; Ed25519 verification uses WebCrypto.

```ts
import { CoolBeans } from '@coolbeans/sdk';

const cb = new CoolBeans({
  publicKeys: { '1': 'BASE64_PUBLIC_KEY' }, // bundle these in your app
  // product: 'clementine',  // required only if you sell more than one product — see below
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
install activates binds the app to that product, and every later key is checked against it — but
that first key is the one nobody checked, so a customer holding a licence for your other app could
paste it into a fresh install and unlock this one. Pass the slug and a licence for anything else is
refused outright.

## The verdict

```ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null }
{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null }
```

Branch on `decision`. Nothing else. `reason` is for what you say to the user: `grace` means nudge
them online, `uninitialized` means ask for a key, `revoked` means the licence is gone.

It is a union rather than a boolean on purpose. "We have never established an entitlement" and
"you were revoked" both mean locked, but they are different screens, and a boolean loses that.

`license` is the frozen §9 object, read off the cached token, so showing "Pro monthly, renews 12
Aug" costs no extra call. It is display only — never gate a feature on `plan` or `kind`.

## Gating features: `state.entitlements`

When a vendor prices capabilities, they arrive here, and this is the only thing to gate on:

```ts
if (state.entitlements?.export_4k) enableExport4k();
const batchLimit = Number(state.entitlements?.batch_limit ?? 1);
```

The field is absent when a licence has none, so keep the `?.`.

These are server-authored and signed into the token, which is what makes them safe in client
code. `license.plan` is a label a vendor types and `license.kind` is our lifecycle bookkeeping:
both are display only. `if (plan === 'Pro')` breaks the day somebody renames a tier.

## What `open()` does for you

**Activates on first run, validates after that.** No instance id to hold, no branch to get wrong.

**Refreshes on its own**, at a third of the token's lifetime, jittered so every install of your app
does not wake on the same tick and stampede one server. A changed verdict arrives via `onChange`;
it does not fire while the answer stays the same.

**Holds a floating seat itself.** It heartbeats once, reads the lease window off the response, and
keeps to about a third of it, so one dropped request does not cost the user their seat. A
node-locked product returns no lease and nothing more is scheduled. Your app does not know or care
which kind it is.

**Never locks out on an inconclusive answer.** Offline, a 5xx, a timeout, an unknown key: all of it
keeps the last known-good state. Only a fetched `disabled` or a signed expiry in the past denies.

**Cannot be extended by moving the clock back.** A wall-clock floor is persisted alongside the
token and expiry is judged against it. A successful validation resets the floor, so a briefly wrong
clock is not a life sentence.

**Does not keep a CLI alive.** The background timers are unref'd, so a tool that opens, prints and
exits, exits.

### Anti-patterns

**Do not check on every feature use or window focus.** That is what the cached token is for, and it
turns a momentary network blip into visible flakiness.

**Do not treat a failed check as a reason to do anything abrupt.** A failure is the inconclusive
case. `open()` already resolves it to the last good state, and nothing in the background throws
into your app.

**Do not reach for `verify` / `verifyOffline` first.** They still work, and `open()` is built from
them, but every lockout bug we have seen came from an app wiring those two together itself.

**Do not hard-code a seat count or a feature list.** How many seats a licence gets and which
capabilities it carries are read off the licence, never assumed from the product: one product can
sell three seats or ten, and a capability can move between tiers, with no app release.

## Offline behaviour

`offlineState()` is network-free and returns one of three states:

| State | Meaning |
|---|---|
| `valid` | Cached token verified and inside its TTL |
| `grace` | Past the TTL but the licence has not expired — **still unlock** |
| `expired` | No token, bad signature, wrong device or product, disabled, or the licence expired |

`verifyOffline()` unlocks on `valid` and `grace`.

Three rules are worth knowing because they carry product decisions:

**A network failure never locks anyone out.** Grace past the token TTL is unbounded for paid tiers.
That is the offline-tolerant contract, and it is why an app on a plane keeps working.

**A signed `expires_at` in the past ends access, for every tier.** The token states the licence ended,
so honouring it is reading the credential rather than guessing from a failed request. The server
issues that date with a buffer, so a subscriber who renews while offline has room to reconnect.

**Trials get no grace at all**, or blocking the endpoint would be an unlimited trial.

## Storage

Pass a durable `storage` outside the browser. The default falls back to memory and warns loudly,
because losing the device id on restart mints a new one and consumes another activation seat each
time.

```ts
const cb = new CoolBeans({ product: 'clementine', storage: myFileBackedStore });
```

## Errors

Server errors throw `CoolBeansError` carrying the HTTP status and the machine-readable code, so you
can branch on `unknown_key` versus `license_disabled` rather than parsing prose.
