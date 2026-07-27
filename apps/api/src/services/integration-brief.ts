// ABOUTME: Agent-shaped integration docs (issue #64) — a product-agnostic SDK guide and a
// ABOUTME: per-product brief, both public markdown an AI coding agent can fetch and act on.

/** The product fields a brief needs. Kept narrow so the route can pass its Product straight in. */
export interface BriefProduct {
	slug: string;
	name: string;
	keyPrefix: string;
	activationModel: string;
	activationLimit: number;
}

const SWIFT_PACKAGE_URL = 'https://github.com/GoldenBerry-SO/coolbeans-swift.git';

function isFloating(model: string): boolean {
	return model === 'floating';
}

function seatModelWords(model: string): string {
	return isFloating(model) ? 'Concurrent (floating)' : 'Per device (node-locked)';
}

/**
 * The comprehensive, product-agnostic integration guide. This is the how-to code and the
 * frozen contract; a per-product brief supplies the real values to use with it. Written for
 * a coding agent to read once and wire Cool Beans in with no back-and-forth.
 */
export function buildAgentGuide(): string {
	return `# Cool Beans integration guide (for coding agents)

Cool Beans is a software license service. Your app makes **one call** on launch and gets **one
verdict** back. It is offline-tolerant by contract, so a licensed user keeps working when our
server is unreachable.

## The one rule that matters

Access is refused only on a *definitive* answer. The SDK already sorts the definitive from the
inconclusive, so in your code the rule is simply: **branch on \`state.decision\`, and nothing
else.**

What that resolves for you:

- **Disabled licence** -> \`deny\`, reason \`revoked\`. This is the only signal that takes access away.
- **A signed expiry that has passed** -> \`deny\`, reason \`expired\`. Our own credential saying the
  licence ended, which is how a lapsed subscription reaches a machine that has gone dark.
- **Never activated on this device** -> \`deny\`, reason \`uninitialized\`. Ask for a key. This is not
  a revocation, so do not phrase it as one.
- **Network failure, a timeout, a 404, a 5xx, an answer about a different product** -> **\`allow\`**,
  on the last known-good state. Every one of these is inconclusive. **Never lock a user out on an
  inconclusive answer** — the SDK does not, and neither should anything you add.

Do not add your own checks on top. Do not compare dates, inspect \`license.status\`, or decide what
a failed request meant: that is the whole job of \`open()\`, and every lockout we have seen came
from an app second-guessing it. If you get this wrong, an outage of ours locks out your paying
customers.

## Install

- JavaScript / TypeScript (Node, Electron, Tauri, browser): \`npm i @coolbeans/sdk\`
- Swift (macOS): add the SwiftPM package \`${SWIFT_PACKAGE_URL}\` from \`0.1.0\`.

## Integrate (TypeScript) — this is the whole thing

\`\`\`ts
import { CoolBeans } from '@coolbeans/sdk'

const cb = new CoolBeans({
  baseUrl: '<your-base-url>',
  product: '<your-product-slug>',
  // Bundle the product's public keys so the first offline check needs no network call.
  // The SDK also fetches and caches them by licence key when they are missing.
  publicKeys: { /* '<kid>': '<key>' */ },
  // Required outside the browser — see Storage below. The browser uses localStorage.
  storage: myDurableStorage,
})

// On launch, and again whenever the user pastes a key. One call.
const state = await cb.open(licenseKey, {
  deviceName: machineName(),   // what the vendor sees for this seat; a hostname often carries a
                               // person's name, so send something the user would expect to share
  onChange: (next) => { if (next.decision === 'deny') lock(next) },
})
if (state.decision === 'deny') lock(state)
else unlock()

await cb.release()  // sign out: gives the seat back. false means it did not reach us, so retry.
cb.stop()           // shutdown: ends the background refresh
\`\`\`

Two things worth stating because they look like traps and are not: \`publicKeys: {}\` is fine — the
SDK fetches and caches them by licence key on the first \`open()\`, and offline-before-that is
\`uninitialized\`, never a wrong unlock. And \`open()\` with no argument is exactly \`open(undefined)\`:
after the first call the key is stored, so a relaunch needs nothing passed.

## Storage — get this right or you will burn your customer's seats

Outside a browser the SDK **throws at construction** without durable storage, on purpose. In-memory
storage mints a new device id every launch, so every launch takes another activation, and a
node-locked licence is spent in a handful of restarts. The interface is two synchronous methods:

\`\`\`ts
interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
\`\`\`

Node, Electron or Tauri: back it with a file the user's profile keeps. Anything durable works —
\`electron-store\`, the Tauri store plugin, the Keychain:

\`\`\`ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function fileStorage(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const read = (): Record<string, string> => {
    try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
  }
  return {
    getItem: (k: string) => read()[k] ?? null,
    setItem: (k: string, v: string) => {
      writeFileSync(path, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 })
    },
  }
}
\`\`\`

\`open()\` activates on first run, validates after that, refreshes on its own cadence, holds a
floating seat if the product has them, and falls back to the cached signed token when the
network is gone. There is no instance id to keep and no interval to choose.

**Always pass \`product\`** — the brief has the slug. It is technically optional, and omitting it is
only safe for a vendor with exactly one product: without it the first licence an install activates
decides which product the app is bound to, and that first key is the one nobody checked. A customer
holding a licence for the vendor's *other* app could paste it into a fresh install and unlock this
one. With the slug set, a licence for anything else is refused at activation, and while the app is
running an answer about another product stays inconclusive — so a wrong slug in your build cannot
lock anybody out, it just never unlocks.

The verdict:

\`\`\`ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null,
  entitlements?: Record<string, boolean | number | string> }
{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null,
  entitlements?: Record<string, boolean | number | string> }
\`\`\`

\`entitlements\` is top-level, not inside \`license\`, and absent when the licence has none. It is
present on a \`deny\` too, since it comes off the same token — but gate on it only when the decision
is \`allow\`, or you are handing capabilities to somebody whose licence just ended.

Branch on \`decision\` and nothing else. \`reason\` is only for what you say to the user:

- \`online\` / \`cached\` — say nothing.
- \`grace\` — working from a cached licence. Optionally nudge them online. **Not** an error, and not
  worth a modal: it happens to anyone on a plane.
- \`clock_rollback\` — unlocked, but this machine's clock went backwards. Treat it exactly like
  \`cached\`; mention the clock only if you have somewhere sensible to say it.
- \`uninitialized\` — show the licence-key form.
- \`expired\` — the licence ended. Point at renewal.
- \`revoked\` — the licence was taken away. Point at support.

\`license\` is the §9 object for display — the plan label and renewal date. Never gate a feature on
it. \`expiresAt\` is the same value as \`license.expires_at\`, lifted out for convenience.

\`onChange\` fires whenever the verdict changes after \`open()\` returned, including allow-to-allow
changes like \`online\` -> \`cached\`. It does not fire while the answer stays the same, so it is safe
to re-render from it.

## Gating features: entitlements

Some products sell tiers that differ in what the software does. Those capabilities arrive as
\`state.entitlements\`, and that is the **only** thing to gate a feature on:

\`\`\`ts
if (state.entitlements?.export_4k) enableExport4k()
const batchLimit = Number(state.entitlements?.batch_limit ?? 1)
\`\`\`

The field is absent when a licence has none, so \`?.\` is not optional politeness — write it. Values
are booleans, numbers or strings, never nested, so \`Number(x ?? 1)\` and \`=== true\` are safe.

Why this and not \`plan\`: entitlements are authored on the server and **signed** into the token
alongside the expiry, so a client can trust them. \`plan\` and \`kind\` are a vendor's own label and
our lifecycle bookkeeping, they are display only, and \`if (plan === "Pro")\` breaks the day
somebody renames a tier or adds "Pro annual". Never write that.

**The names are the vendor's, not ours.** The brief lists the ones this product's prices actually
grant; if it lists none, ask the vendor before writing a check, because an absent name means the
feature stays off and nothing anywhere will report that as an error.

## Integrate (Swift, macOS)

The same call, the same verdict, the same reason names:

\`\`\`swift
import CoolBeans

let cb = CoolBeans(configuration: .init(
  product: "<your-product-slug>",
  baseURL: URL(string: "<your-base-url>")!,
  publicKeys: ["<kid>": "<key>"]
))

// On launch, and again whenever the user pastes a key.
let state = await cb.open(licenseKey: key)
if state.decision == .deny { lockOut(state) } else { unlock() }

// Gating a feature, same rule as above: only ever on a signed entitlement.
if state.isEntitled("export_4k") { enableExport4k() }
let batchLimit = state.limit("batch_limit") ?? 1
\`\`\`

Same behaviour as TypeScript, including the background refresh and holding a floating seat: pass
\`onChange:\` to hear about a changed verdict, \`cb.stop()\` on shutdown, \`await cb.release()\` on
sign-out. Nothing to schedule.

\`LicenseGate\` wraps all of this for SwiftUI if you would rather observe a status than a verdict.

## The whole surface

Four calls, and you will use two of them:

- \`open(licenseKey?)\` -> the verdict above. On launch, and again when a key is pasted. The key
  is optional after the first call: it is stored for you.
- \`release()\` -> frees this device's seat, forgets the licence, and ends the background refresh.
  On sign-out. Returns false when it could not reach us, and then **nothing was cleared** — so the
  retry still has what it needs, and the seat is genuinely still held. After a true, \`open(newKey)\`
  starts again from scratch.
- \`stop()\` -> ends the background refresh. On app shutdown. Synchronous, nothing to await.
- \`importActivation(blob)\` -> unlocks a machine that will never reach the network, from a
  vendor-issued signed blob. Only if the vendor offers that.
- \`activate(licenseKey)\` -> for a **key-entry form only**, when you want to tell the user *why* a
  key was refused. \`open()\` deliberately swallows that, because an unknown key is inconclusive and
  must never read as a revocation, which leaves you unable to say "we could not verify that key".
  \`activate\` throws a \`CoolBeansError\` with a \`body.error\` code you can show. Follow it with
  \`open()\`; never gate the app on its result.

There are lower-level calls in the SDK. You do not need them, and every lockout bug we have
seen came from wiring them together by hand. Use \`open()\`.

## Public HTTP endpoints — only if there is no SDK for your language

**Skip this section if you are using \`@coolbeans/sdk\` or the Swift SDK.** It is here for languages
we do not ship one for. Wiring these up by hand means re-deciding everything \`open()\` decides,
which is exactly where lockouts come from.

Every request carries the license key. There is no service secret; the key is the credential.

\`\`\`
POST /v1/activate    { license_key, instance_name }        -> { ok, license, instance }
POST /v1/validate    { license_key, instance_id }          -> { ok, valid, license, instance, token? }
POST /v1/heartbeat   { license_key, instance_id }          -> { ok, lease_expires_at }
POST /v1/deactivate  { license_key, instance_id }          -> { ok }
POST /v1/keyset      { license_key }                       -> { ok, algorithm: "ed25519", keys }
GET  /v1/pubkey?product=<slug>                             -> { ok, algorithm: "ed25519", keys }
\`\`\`

\`license\` is \`{ key, status, kind, plan, product, expires_at }\`; \`instance\` is \`{ id, name }\`.
\`status\` is \`"active"\` or \`"disabled"\`. \`kind\` is \`perpetual|subscription|trial\` and \`plan\` is a
vendor label — both are display only, never branch app logic on them. \`token\` is a signed offline
token; cache it.

## Offline verification and embedded keys

Offline tokens are ed25519-signed. \`keys\` is a map of \`kid -> public key\`: fetch it by licence
key with \`POST /v1/keyset { license_key }\`, or by slug with \`GET /v1/pubkey?product=<slug>\`.
Embed them, or let the SDK fetch and cache them. A token past its \`expires_at\` is definitive,
so subscriptions get a small server-side grace buffer before the raw expiry; trials do not.

## Seat models, and why you do not care

- **Per device (node-locked):** each seat binds to one machine until it is released.
- **Concurrent (floating):** seats are a shared pool. A running machine holds one and gives it
  back when it stops.

**A TypeScript app does nothing differently for either.** The SDK asks, hears a lease window back,
and holds the seat itself. Picking an interval in your app is you deciding whether your own users
get locked out, which is the wrong place for it.

**Seats are enforced on the server and your app never counts them.** There is no seat count on the
verdict or the licence, deliberately: how many a price buys is the vendor's business, and running
out shows up the only way it can matter to you — as a \`deny\` you already handle. Do not build a
device list or a seat policy from anything here.

Capabilities are the one thing that does vary per licence, and they come from
\`state.entitlements\`. One product can sell Basic and Pro, and a capability can move between tiers,
with no app release.

## Common patterns

1. **Launch and key entry:** \`const state = await cb.open(key, { onChange })\`, then
   \`if (state.decision === 'deny') lock(state)\`.
2. **Show what they bought:** read \`state.license.plan\` and \`state.license.expires_at\`. Display
   only.
3. **Gate a feature:** \`state.entitlements?.<name>\`. Never \`plan\`, never \`kind\`.
4. **Sign out:** \`await cb.release()\`.
`;
}

/**
 * A per-product brief: the product's real config and public keys, plus a pointer to the guide.
 * Public and secret-free by construction (slugs and public keys only), so it is safe to host
 * at a stable URL an agent can fetch.
 */
export function buildProductBrief(args: {
	product: BriefProduct;
	baseUrl: string;
	publicKeys: Record<string, string>;
	guideUrl: string;
	/**
	 * The entitlement names this product's active grants actually grant. An app must not invent
	 * one: an absent name simply reads as off, with nothing anywhere reporting it, so a guessed
	 * name silently disables a feature a customer paid for.
	 */
	entitlementNames?: string[];
}): string {
	const { product, baseUrl, publicKeys, guideUrl } = args;
	const entitlementNames = args.entitlementNames ?? [];
	const floating = isFloating(product.activationModel);
	const keyEntries = Object.entries(publicKeys);
	const keysBlock = keyEntries.length
		? `\`\`\`json\n${JSON.stringify(publicKeys, null, 2)}\n\`\`\``
		: `_None issued yet. The SDK fetches them by licence key from \`${baseUrl}/v1/keyset\` on the first \`open()\`, so an integration works before the first key is signed. Paste them here once they exist to skip that call. (\`${baseUrl}/v1/pubkey?product=${product.slug}\` serves the same keys by slug.)_`;

	const endpoints = [
		`POST ${baseUrl}/v1/activate    { license_key, instance_name }   -> { ok, license, instance }`,
		`POST ${baseUrl}/v1/validate    { license_key, instance_id }     -> { ok, valid, license, token? }`,
		...(floating
			? [
					`POST ${baseUrl}/v1/heartbeat   { license_key, instance_id }     -> { ok, lease_expires_at }`,
				]
			: []),
		`POST ${baseUrl}/v1/deactivate  { license_key, instance_id }     -> { ok }`,
		`POST ${baseUrl}/v1/keyset      { license_key }                  -> { ok, algorithm, keys }`,
		`GET  ${baseUrl}/v1/pubkey?product=${product.slug}          -> { ok, algorithm, keys }`,
	].join('\n');

	return `# Cool Beans integration brief: ${product.name}

Hand this to your coding agent along with the guide at ${guideUrl}. The guide has the full
how-to code for every framework; this brief has ${product.name}'s real values to use with it.

## This product's config

- **Base URL:** ${baseUrl}
- **Product slug:** ${product.slug}
- **Key prefix:** ${product.keyPrefix} (keys look like ${product.keyPrefix}-XXXX-XXXX-XXXX-XXXX)
- **Seat model:** ${seatModelWords(product.activationModel)}, ${product.activationLimit} per key by default (a price can buy more or fewer; enforced on our side, so the app never counts them)
- **Seat handling:** ${floating ? 'the TypeScript SDK holds the floating seat itself; a Swift app calls `holdSeat()` on a timer' : 'nothing to do (per-device seats)'}

## Embedded public keys (ed25519, for offline verification)

${keysBlock}

## Capabilities this product grants

${
	entitlementNames.length
		? `Read these from \`state.entitlements\`, and nothing else, when deciding what a licence unlocks:

${entitlementNames.map((name) => `- \`${name}\``).join('\n')}

Not every licence carries every one — each licence names its own, set by the price it was
bought through or by the vendor issuing it directly. Absent means off, so write
\`state.entitlements?.<name>\` and treat missing as no.`
		: `This product's prices grant **no capabilities**, so \`state.entitlements\` will be absent and
there is nothing to gate on. Do not invent a name and check for it: it would read as off forever,
and nothing would report that as an error. If a paid-only feature is meant to exist, ask the vendor
to add the capability to the price first.`
}

## Endpoints this app calls

\`\`\`
${endpoints}
\`\`\`

## Do this

Read the guide at ${guideUrl} and integrate Cool Beans using the config above. The whole app-side
integration is one call on launch, and again when the user pastes a key:

\`\`\`ts
const state = await cb.open(licenseKey, {
  onChange: (next) => { if (next.decision === 'deny') lock(next) },
})
if (state.decision === 'deny') lock(state)
else unlock()
\`\`\`

Branch on \`state.decision\` and nothing else. Gate any paid-only feature on
\`state.entitlements?.<name>\`, never on \`state.license.plan\`. Call \`cb.release()\` on sign-out and
\`cb.stop()\` on shutdown.${
		floating
			? ' This product uses concurrent seats; the TypeScript SDK holds the seat for you, so do not write a heartbeat.'
			: ''
	}

Do not write a refresh loop or keep an instance id — the SDK owns both. Remember the one rule: an
inconclusive check never locks the user out.
`;
}
