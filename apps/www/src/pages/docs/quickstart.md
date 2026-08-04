---
layout: ../../layouts/DocsLayout.astro
title: Quickstart
description: Issue a key, wire three lines into your app, and see the verdict.
---

Two steps: get a key, then make one call in your app.

## 1. Issue a key

**In the console.** Sign in, pick the product, and hit **Issue key** in the header. You get a
product slug, a key prefix, and the key itself.

**Or from the CLI.** The `beans` CLI talks to the same admin API:

```sh
beans key issue --product clementine --email you@example.com
```

That prints the key. Add `--kind subscription`, `--plan "Pro monthly"`, `--seats 5` or
`--entitlements '{"export_4k":true}'` if you want more than the defaults. See
[the CLI reference](/docs/cli) for every command, and note it isn't published to npm yet, so
today you run it from the repo.

Keys look like `CLEM-XXXX-XXXX-XXXX-XXXX`. The prefix is per-product, and it's how the server
resolves which product a key belongs to.

## 2. Wire it into your app

This is the whole integration:

```ts
const state = await cb.open(licenseKey);   // on launch, and when a key is pasted
if (state.decision === 'deny') lock(state);
await cb.release();                        // on sign-out
```

With the constructor, in full:

```ts
import { CoolBeans } from '@coolbeans/sdk';

const cb = new CoolBeans({
  baseUrl: 'https://licences.example.com',
  product: 'clementine',
  publicKeys: { '1': 'BASE64_PUBLIC_KEY' }, // bundle these; optional, the SDK can fetch them
  storage: myDurableStorage,                // required outside the browser
});

const state = await cb.open(licenseKey, {
  onChange: (next) => setLicensed(next.decision === 'allow'),
});
if (state.decision === 'deny') lockOut(state);
```

`open()` activates on first run, validates after that, refreshes when it can, falls back to the
cached signed token when it can't, and holds a floating seat itself. Every inconclusive answer
keeps the app unlocked. Only a fetched `disabled` or a signed expiry denies.

**Outside a browser, always pass a durable `storage`.** Without it the SDK falls back to memory, a
fresh device id is minted on every start, and each start consumes another activation seat until the
customer is locked out of their own licence. The browser gets `localStorage` automatically.

## What the verdict looks like

```ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null, entitlements?: {...} }

{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null, entitlements?: {...} }
```

Branch on `decision`. Nothing else. `reason` is for what you say to the user: `grace` means nudge
them online, `uninitialized` means ask for a key, `revoked` means the licence is gone.

Gate paid features on `state.entitlements`, never on `state.license.plan`:

```ts
if (state.entitlements?.export_4k) enableExport4k();
```

## Per-host storage

The licensing is identical everywhere. The only thing that changes between hosts is **where the
device identity lives**, because that's what decides whether a restart burns another seat.

| Host | Storage to pass | Why |
|---|---|---|
| Browser | none (default) | `localStorage` is picked up automatically |
| Electron | `electron-store` or a file in `app.getPath('userData')` | survives restarts and updates |
| Tauri | the Stronghold plugin or a file in the app config dir | same |
| Node / CLI | a file under `~/.config/<app>` | a daemon restart must not re-activate |

Copyable single-file quickstarts for all four live in `examples/` in the repo:
`browser.ts`, `electron-main.ts`, `tauri.ts`, `node-cli.ts`.

## Hand it to a coding agent

Every instance serves two markdown documents written for an AI coding agent to read once and wire
Cool Beans in with no back-and-forth:

- `GET /v1/llms.txt`: the full, product-agnostic integration guide.
- `GET /v1/integration/<your-product-slug>`: your product's real base URL, slug, key prefix, seat
  model, embedded public keys, and the capability names your prices actually grant.

Both are public markdown with no secrets in them. Point your agent at the two URLs on your own
instance and it has everything.

## Next

- [TypeScript SDK](/docs/sdk-typescript) for the full surface.
- [Swift SDK](/docs/sdk-swift) for macOS and iOS.
- [Payments](/docs/payments) to turn a Stripe price into a key.
