// ABOUTME: Pure builders for a product's Integration view (issue #61) — config facts, SDK
// ABOUTME: snippets, and the public endpoints, all pre-filled with the product's real values.

import type { Product } from './types.js';

/** A copyable fact about the product's integration. `mono` renders in a code style. */
export interface ConfigFact {
	label: string;
	value: string;
	mono: boolean;
	/** One line of context under the value, when it needs explaining. */
	hint?: string;
}

/** A public `/v1` endpoint the customer's app calls. No auth beyond the key itself. */
export interface EndpointFact {
	method: string;
	path: string;
	what: string;
}

/** A framework-specific integration snippet, pre-filled and copyable. */
export interface Snippet {
	target: SnippetTarget;
	label: string;
	/** The Prism-ish language tag for display; also used for the fenced block in copy. */
	language: string;
	/** The install/dependency line, when the target has one. */
	install?: string;
	code: string;
}

export type SnippetTarget = 'node' | 'electron' | 'tauri' | 'browser' | 'swift';

/** The hosted base URL every snippet defaults to when the console is on cloud. */
export const HOSTED_BASE_URL = 'https://app.coolbeans.tools';

const SWIFT_PACKAGE_URL = 'https://github.com/GoldenBerry-SO/coolbeans-swift.git';

/** True when this product hands out concurrent seats, which is what needs a heartbeat. */
export function isFloating(product: Pick<Product, 'activationModel'>): boolean {
	return product.activationModel === 'floating';
}

/** The hosted machine-readable brief for a product (issue #64). Public, no secrets. */
export function briefUrl(baseUrl: string, slug: string): string {
	return `${baseUrl}/v1/integration/${slug}`;
}

/** The hosted, product-agnostic SDK guide for coding agents (issue #64). */
export function guideUrl(baseUrl: string): string {
	return `${baseUrl}/v1/llms.txt`;
}

/**
 * The one-block prompt a developer pastes into their coding agent. It points the agent at
 * the hosted brief and guide, so the agent fetches everything and wires Cool Beans in.
 */
export function agentPrompt(product: Product, baseUrl: string): string {
	const seat = isFloating(product) ? 'concurrent (floating)' : 'per device (node-locked)';
	return [
		`Read ${briefUrl(baseUrl, product.slug)} and ${guideUrl(baseUrl)}, then integrate Cool Beans licensing into this app.`,
		`Product: ${product.slug}`,
		`Base URL: ${baseUrl}`,
		`Seat model: ${seat}`,
	].join('\n');
}

/** The plain config facts: base URL, slug, prefix, seat model. All public, all copyable. */
export function configFacts(product: Product, baseUrl: string): ConfigFact[] {
	// Plain words, matching the rest of the console (issue #59). The wire term lives in the
	// agent brief, where an agent needs it to map to the API's activation_model.
	const seat = isFloating(product) ? 'Concurrent' : 'Per device';
	return [
		{ label: 'Base URL', value: baseUrl, mono: true },
		{ label: 'Product slug', value: product.slug, mono: true },
		{
			label: 'Key prefix',
			value: product.keyPrefix,
			mono: true,
			hint: `Keys look like ${product.keyPrefix}-XXXX-XXXX-XXXX.`,
		},
		{
			label: 'Seat model',
			value: `${seat} · ${product.activationLimit} per key`,
			mono: false,
			hint: isFloating(product)
				? 'Seats are a shared pool; the app heartbeats to hold one while running.'
				: 'Each seat binds to one machine until it is deactivated. No heartbeat needed.',
		},
	];
}

/** The public endpoints the app will hit. Heartbeat only appears for a floating product. */
export function publicEndpoints(
	product: Pick<Product, 'activationModel' | 'slug'>,
): EndpointFact[] {
	const base: EndpointFact[] = [
		{
			method: 'POST',
			path: '/v1/activate',
			what: 'Bind a key to this machine, returns an instance id.',
		},
		{
			method: 'POST',
			path: '/v1/validate',
			what: 'Check a key online; falls back to offline when unreachable.',
		},
	];
	if (isFloating(product)) {
		base.push({
			method: 'POST',
			path: '/v1/heartbeat',
			what: 'Hold the floating seat while the app runs; extends the lease.',
		});
	}
	base.push(
		{
			method: 'POST',
			path: '/v1/deactivate',
			what: 'Release the seat so another machine can take it.',
		},
		{
			method: 'GET',
			path: `/v1/pubkey?product=${product.slug}`,
			what: 'The public signing keys for offline verification (already embedded above).',
		},
	);
	return base;
}

/**
 * Render the embedded public keys as a JS object literal for a snippet. Empty keys give an
 * empty object with a comment, so the snippet still runs and the fetch-on-first-verify path
 * fills them in (the SDK persists keys it fetches).
 */
function keysLiteral(publicKeys: Record<string, string>): string {
	const entries = Object.entries(publicKeys);
	if (entries.length === 0) return '{ /* fetched from /v1/pubkey on first verify */ }';
	const lines = entries.map(([kid, key]) => `\t\t'${kid}': '${key}',`);
	return `{\n${lines.join('\n')}\n\t}`;
}

/** The Swift dictionary form of the embedded keys. */
function swiftKeysLiteral(publicKeys: Record<string, string>): string {
	const entries = Object.entries(publicKeys);
	if (entries.length === 0) return '[:] // fetched from /v1/pubkey on first verify';
	const lines = entries.map(([kid, key]) => `\t\t"${kid}": "${key}",`);
	return `[\n${lines.join('\n')}\n\t]`;
}

function tsClient(product: Product, baseUrl: string, publicKeys: Record<string, string>): string {
	return [
		`import { CoolBeans } from '@coolbeans/sdk'`,
		'',
		`const cb = new CoolBeans({`,
		`\tproduct: '${product.slug}',`,
		`\tbaseUrl: '${baseUrl}',`,
		`\t// Bundle the keys so the app verifies offline with no first-run network call.`,
		`\tpublicKeys: ${keysLiteral(publicKeys)},`,
		`})`,
	].join('\n');
}

/**
 * The whole integration, the same for every TS target and every seat model. One call
 * activates if it needs to, refreshes when it can, falls back to the cached signed token
 * when it cannot, and holds a floating seat on its own.
 */
const TS_OPEN = [
	'// On launch, and again whenever the user pastes a key:',
	'async function onLaunch(key: string) {',
	'\tconst state = await cb.open(key, {',
	'\t\t// Fires when the verdict changes later, so a revocation reaches a running app.',
	'\t\tonChange: (next) => { if (next.decision === "deny") lock(next) },',
	'\t})',
	'\tif (state.decision === "deny") return lock(state)',
	'\tunlock()',
	'\t// For display only: state.license has the plan and the renewal date. Never gate on it.',
	'\tshowPlan(state.license)',
	'}',
	'',
	'// On shutdown, so nothing is left running:',
	'// cb.stop()',
].join('\n');

function tsSnippet(
	target: Extract<SnippetTarget, 'node' | 'electron' | 'tauri' | 'browser'>,
	label: string,
	storageNote: string,
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
): Snippet {
	const code = [storageNote, tsClient(product, baseUrl, publicKeys), '', TS_OPEN].join('\n');
	return { target, label, language: 'ts', install: 'npm i @coolbeans/sdk', code };
}

function swiftSnippet(
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
): Snippet {
	// Swift has no run loop of its own, so a floating app schedules its own beats. Everything
	// else is the same one call the TypeScript SDK makes.
	const seat = isFloating(product)
		? [
				'',
				'// Floating: hold the seat while the app runs, at about a third of the lease it',
				'// returns, so one dropped request does not cost the user their seat.',
				'let lease = await cb.holdSeat()',
			].join('\n')
		: '';
	const code = [
		'import CoolBeans',
		'',
		'let cb = CoolBeans(configuration: .init(',
		`\tproduct: "${product.slug}",`,
		`\tbaseURL: URL(string: "${baseUrl}")!,`,
		`\tpublicKeys: ${swiftKeysLiteral(publicKeys)}`,
		'))',
		'',
		'// On launch, and again whenever the user pastes a key. One call.',
		'let state = await cb.open(licenseKey: key)',
		'if state.decision == .deny { return lockOut(state) }',
		'unlock()',
		'// For display only: state.license has the plan and renewal date.',
		`showPlan(state.license)${seat}`,
	].join('\n');
	return {
		target: 'swift',
		label: 'Swift (macOS)',
		language: 'swift',
		install: `.package(url: "${SWIFT_PACKAGE_URL}", from: "0.1.0")`,
		code,
	};
}

/** Every framework snippet for a product, pre-filled with its real config and public keys. */
export function buildSnippets(
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
): Snippet[] {
	return [
		tsSnippet(
			'node',
			'Node',
			'// Node has no localStorage: pass a durable storage, or every restart burns a seat.',
			product,
			baseUrl,
			publicKeys,
		),
		tsSnippet(
			'electron',
			'Electron (main)',
			'// Run this in the main process and back storage with electron-store or a file.',
			product,
			baseUrl,
			publicKeys,
		),
		tsSnippet(
			'tauri',
			'Tauri',
			'// Back storage with the Tauri store plugin so the device id survives restarts.',
			product,
			baseUrl,
			publicKeys,
		),
		tsSnippet(
			'browser',
			'Browser',
			'// The browser uses localStorage automatically, so no storage option is needed.',
			product,
			baseUrl,
			publicKeys,
		),
		swiftSnippet(product, baseUrl, publicKeys),
	];
}
