# Cool Beans quickstarts

Four ways to wire a product to Cool Beans, per PRD §11. Each is a single file you can copy.

The licensing is the same three lines everywhere:

```ts
const state = await cb.open(licenseKey);   // on launch, and when a key is pasted
if (state.decision === 'deny') lock(state);
await cb.release();                        // on sign-out
```

`open()` activates on first run, refreshes when it can, falls back to the cached signed token when it
cannot, and holds a floating seat itself. Every inconclusive answer keeps the app unlocked; only a
fetched `disabled` or a signed expiry denies. Gate features on `state.entitlements`, never on
`state.license.plan`.

So the only thing that actually changes between these files is **where the device identity lives**,
because that is what decides whether a restart burns another seat.

| Host | Storage to pass | Why |
|---|---|---|
| Browser | none (default) | `localStorage` is picked up automatically |
| Electron | `electron-store` or a file in `app.getPath('userData')` | survives restarts and updates |
| Tauri | the Stronghold plugin or a file in the app config dir | same |
| Node / CLI | a file under `~/.config/<app>` | a daemon restart must not re-activate |

**The one rule:** outside a browser, always pass a durable `storage`. Without it the SDK
falls back to memory (and warns), a fresh device id is minted on every start, and each
start consumes another activation seat until the customer is locked out of their own
license.

- [`browser.ts`](browser.ts)
- [`electron-main.ts`](electron-main.ts)
- [`tauri.ts`](tauri.ts)
- [`node-cli.ts`](node-cli.ts)
