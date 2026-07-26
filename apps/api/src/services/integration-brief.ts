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

Cool Beans is a software license service. Your app **activates** a license key on a device,
then **validates** it. It is offline-tolerant by contract, so a licensed user keeps working
even when your server is unreachable.

## The one rule that matters

An answer is only a revocation when it is *definitive*. Concretely:

- **Unknown key** -> the server returns 404. That is not a revocation on its own.
- **Disabled key** -> the license object comes back with \`status: "disabled"\`. This is the
  only signal that revokes access.
- **Network failure, a non-200, a malformed body, or a product mismatch** -> inconclusive.
  **Never lock the user out on an inconclusive result.** Fall back to offline verification.

If you get this wrong, an outage of ours locks out your paying customers. Do not.

## Install

- JavaScript / TypeScript (Node, Electron, Tauri, browser): \`npm i @coolbeans/sdk\`
- Swift (macOS): add the SwiftPM package \`${SWIFT_PACKAGE_URL}\` from \`0.1.0\`.

## Integrate (TypeScript) — this is the whole thing

\`\`\`ts
import { CoolBeans } from '@coolbeans/sdk'

const cb = new CoolBeans({
  baseUrl: '<your-base-url>',
  // Bundle the product's public keys so offline verify needs no first-run network call.
  // The SDK also fetches and caches them by licence key when they are missing.
  publicKeys: { /* '<kid>': '<key>' */ },
  // Node/Electron/Tauri: pass durable storage, or every restart mints a new device id and
  // burns a seat. The browser uses localStorage automatically.
  // storage: myDurableStorage,
})

// On launch, and again whenever the user pastes a key. One call.
const state = await cb.open(licenseKey, {
  onChange: (next) => { if (next.decision === 'deny') lock(next) },
})
if (state.decision === 'deny') lock(state)
else unlock()

// On shutdown: cb.stop()
\`\`\`

\`open()\` activates on first run, validates after that, refreshes on its own cadence, holds a
floating seat if the product has them, and falls back to the cached signed token when the
network is gone. There is no instance id to keep and no interval to choose.

The verdict:

\`\`\`ts
{ decision: 'allow', reason: 'online' | 'cached' | 'grace' | 'clock_rollback',
  license: LicenseObject | null, expiresAt: string | null }
{ decision: 'deny',  reason: 'revoked' | 'expired' | 'uninitialized',
  license: LicenseObject | null }
\`\`\`

Branch on \`decision\` and nothing else. \`reason\` is for what you tell the user: \`grace\` means
nudge them online, \`uninitialized\` means ask for a licence key, \`revoked\` means the licence is
gone. \`license\` is the §9 object for display — show the plan and the renewal date from it, never
gate a feature on it.

## Gating features: entitlements

Some products sell tiers that differ in what the software does. Those capabilities arrive as
\`state.entitlements\`, and that is the **only** thing to gate a feature on:

\`\`\`ts
if (state.entitlements?.export_4k) enableExport4k()
const batchLimit = Number(state.entitlements?.batch_limit ?? 1)
\`\`\`

The field is absent when a licence has none, so \`?.\` is not optional politeness — write it.

Why this and not \`plan\`: entitlements are authored on the server and **signed** into the token
alongside the expiry, so a client can trust them. \`plan\` and \`kind\` are a vendor's own label and
our lifecycle bookkeeping, they are display only, and \`if (plan === "Pro")\` breaks the day
somebody renames a tier or adds "Pro annual". Never write that.

Never invent an entitlement name your app checks for and hope the vendor sets it: agree the
names first. An absent name means the feature stays off.

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

Two differences from TypeScript, both because this SDK has no run loop of its own:

- Call \`open()\` again yourself when you want a fresh answer. There is no background refresh.
- For a **floating** product, call \`await cb.holdSeat()\` on a timer at roughly a third of the
  lease window it hands back, or the seat lapses while the app is still running.

Sign-out is \`await cb.release()\`, same as TypeScript.

\`LicenseGate\` wraps all of this for SwiftUI if you would rather observe a status than a verdict.

## The whole surface

Four calls, and you will use two of them:

- \`open(licenseKey?)\` -> the verdict above. On launch, and again when a key is pasted. The key
  is optional after the first call: it is stored for you.
- \`release()\` -> frees this device's seat and forgets the licence. On sign-out. Returns false if
  it could not reach us, so you know the seat is still taken.
- \`stop()\` -> ends the background refresh. On app shutdown.
- \`importActivation(blob)\` -> unlocks a machine that will never reach the network, from a
  vendor-issued signed blob. Only if the vendor offers that.

There are lower-level calls in the SDK. You do not need them, and every lockout bug we have
seen came from wiring them together by hand. Use \`open()\`.

## Public HTTP endpoints (if you are not using an SDK)

Every request carries the license key. There is no service secret; the key is the credential.

\`\`\`
POST /v1/activate    { license_key, instance_name }        -> { ok, license, instance }
POST /v1/validate    { license_key, instance_id }          -> { ok, valid, license, instance, token? }
POST /v1/heartbeat   { license_key, instance_id }          -> { ok, lease_expires_at }
POST /v1/deactivate  { license_key, instance_id }          -> { ok }
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

**A TypeScript app does nothing differently for either.** The SDK asks, hears a lease window
back, and holds the seat itself. Picking an interval in your app is you deciding whether your
own users get locked out, which is the wrong place for it. Seats are enforced on the server;
your app never counts them.

How many seats a licence gets, and which capabilities it carries, are **read off the licence,
never assumed from the product**. One product can sell three seats or ten, and a capability can
move between tiers, without your app changing. So: no hard-coded seat count, and no feature
list that is not \`state.entitlements\`.

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
}): string {
	const { product, baseUrl, publicKeys, guideUrl } = args;
	const floating = isFloating(product.activationModel);
	const keyEntries = Object.entries(publicKeys);
	const keysBlock = keyEntries.length
		? `\`\`\`json\n${JSON.stringify(publicKeys, null, 2)}\n\`\`\``
		: `_None issued yet. The SDK fetches them from \`${baseUrl}/v1/pubkey?product=${product.slug}\` on first verify._`;

	const endpoints = [
		`POST ${baseUrl}/v1/activate    { license_key, instance_name }   -> { ok, license, instance }`,
		`POST ${baseUrl}/v1/validate    { license_key, instance_id }     -> { ok, valid, license, token? }`,
		...(floating
			? [
					`POST ${baseUrl}/v1/heartbeat   { license_key, instance_id }     -> { ok, lease_expires_at }`,
				]
			: []),
		`POST ${baseUrl}/v1/deactivate  { license_key, instance_id }     -> { ok }`,
		`GET  ${baseUrl}/v1/pubkey?product=${product.slug}          -> { ok, algorithm, keys }`,
	].join('\n');

	return `# Cool Beans integration brief: ${product.name}

Hand this to your coding agent along with the guide at ${guideUrl}. The guide has the full
how-to code for every framework; this brief has ${product.name}'s real values to use with it.

## This product's config

- **Base URL:** ${baseUrl}
- **Product slug:** ${product.slug}
- **Key prefix:** ${product.keyPrefix} (keys look like ${product.keyPrefix}-XXXX-XXXX-XXXX)
- **Seat model:** ${seatModelWords(product.activationModel)}, ${product.activationLimit} per key by default (a price can buy more or fewer, so read the count off the licence, never assume this one)
- **Heartbeat:** ${floating ? 'yes, at about a third of the lease window (floating seats)' : 'not needed (per-device seats)'}

## Embedded public keys (ed25519, for offline verification)

${keysBlock}

## Endpoints this app calls

\`\`\`
${endpoints}
\`\`\`

## Do this

Read the guide at ${guideUrl} and integrate Cool Beans using the config above. Wire up
activate-on-key-entry, verify-offline-on-launch${floating ? ', and a heartbeat to hold the floating seat' : ''}.
Remember the one rule: an inconclusive check never locks the user out.
`;
}
