# @coolbeans/sdk

Licence checks for Node, Electron, Tauri and the browser. No service secret in the client — the key
is the credential. Zero dependencies; Ed25519 verification uses WebCrypto.

```ts
import { CoolBeans } from '@coolbeans/sdk';

const cb = new CoolBeans({
  product: 'clementine',
  publicKeys: { '1': 'BASE64_PUBLIC_KEY' }, // bundle these in your app
});

// Once, when the user pastes their key
const { instance } = await cb.activate(licenseKey, { name: 'Chris’s MacBook' });

// On every launch
const ok = await cb.verifyOffline();
```

## Recommended integration

The most consequential runtime decision is **how often you check**, and the SDK deliberately does not
decide it for you. Here is what to do.

**Verify once on launch, then roughly every TTL/3 to TTL/2.** With the default 7-day token that means
daily, which gives two or three chances to reconnect before a user drifts into grace. Add jitter, or
every install of your app wakes on the same tick and stampedes one server.

**Floating products heartbeat at a third of the lease**, so a single dropped request does not cost the
user their seat. On the 30-minute default that is every 10 minutes. Node-locked products should never
call `heartbeat` at all.

`start()` does all of that for you, and is optional:

```ts
const watcher = cb.start({
  licenseKey,
  onResult: (r) => setLicensed(r.valid || r.inconclusive),
  // heartbeatMs: 10 * 60_000,  // floating products only
});
// later
watcher.stop();
```

### Anti-patterns

**Do not verify on every feature use or window focus.** That is what the cached token is for, and it
turns a momentary network blip into visible flakiness.

**Do not block app startup on `verify()`.** Gate your UI on `verifyOffline()`, which is instant and
needs no network, and let the online check settle in the background. Otherwise a slow connection makes
your app feel broken.

**Do not treat a failed check as a reason to do anything abrupt.** A failure is the inconclusive case:
carry on with the cached token. Nothing in `start()` throws into your app for this reason.

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
