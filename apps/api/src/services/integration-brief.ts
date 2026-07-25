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

## Set up the client (TypeScript)

\`\`\`ts
import { CoolBeans } from '@coolbeans/sdk'

const cb = new CoolBeans({
  product: '<your-product-slug>',
  baseUrl: '<your-base-url>',
  // Bundle the product's public keys so offline verify needs no first-run network call.
  // The SDK also fetches and caches them from /v1/pubkey when they are missing.
  publicKeys: { /* '<kid>': '<key>' */ },
  // Node/Electron/Tauri: pass durable storage, or every restart mints a new device id and
  // burns a seat. The browser uses localStorage automatically.
  // storage: myDurableStorage,
})
\`\`\`

## Set up the client (Swift, macOS)

\`\`\`swift
import CoolBeans

let cb = CoolBeans(configuration: .init(
  product: "<your-product-slug>",
  baseURL: URL(string: "<your-base-url>")!,
  publicKeys: ["<kid>": "<key>"]
))
\`\`\`

## Core calls

- \`activate(licenseKey, { name })\` -> \`{ license, instance }\`. Call it when the user enters a key.
  Store nothing yourself; the SDK keeps the device id and token.
- \`verify(licenseKey, { instanceId })\` -> a result with \`valid\`, \`license\`, \`inconclusive\`,
  and \`offline\`. Refreshes the cached token online. On an inconclusive result, fall back to
  \`verifyOffline()\`.
- \`verifyOffline()\` -> \`boolean\`. Network-free; unlocks from the cached signed token. Call it
  on launch for an instant unlock, then refresh online in the background.
- \`heartbeat(licenseKey, { instanceId })\` -> holds a **floating** seat. Only for concurrent
  products (see seat models).
- \`deactivate(licenseKey, { instanceId })\` -> frees the seat so another machine can take it.
- \`start({ licenseKey, heartbeatMs? })\` -> a background watcher that re-verifies on an interval,
  and heartbeats too when you pass \`heartbeatMs\` (floating only).

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

Offline tokens are ed25519-signed. \`keys\` from \`/v1/pubkey\` is a map of \`kid -> public key\`.
Embed them (or let the SDK fetch and cache them) so \`verifyOffline()\` works with no network.
A token past its \`expires_at\` is definitive, so subscriptions get a small server-side grace
buffer before the raw expiry; trials do not.

## Seat models

- **Per device (node-locked):** each seat binds to one machine until it is deactivated. No
  heartbeat.
- **Concurrent (floating):** seats are a shared pool. A running machine holds one and releases
  it when it stops. Heartbeat at roughly a third of the lease window so one dropped request
  does not cost the user their seat. Use \`start({ heartbeatMs })\` or call \`heartbeat()\`.

## Common patterns

1. **Activate on key entry:** \`await cb.activate(key, { name: deviceName() })\`, then unlock if
   \`license.status === "active"\`.
2. **Verify offline on launch:** \`if (await cb.verifyOffline()) unlock()\`, then refresh online.
3. **Gate a feature:** check the cached license status; treat inconclusive as still entitled.
4. **Deactivate:** \`await cb.deactivate(key, { instanceId })\` to free a seat on sign-out.
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
- **Seat model:** ${seatModelWords(product.activationModel)}, ${product.activationLimit} per key
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
