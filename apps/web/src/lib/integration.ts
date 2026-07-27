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
	// The links carry the full guide, but some agents will write code from the prompt alone. So the
	// two rules that cause real damage when broken are in the prompt itself.
	return [
		`Read ${briefUrl(baseUrl, product.slug)} and ${guideUrl(baseUrl)}, then integrate Cool Beans licensing into this app.`,
		'',
		`Base URL: ${baseUrl}`,
		`Product slug: ${product.slug}`,
		'',
		'The whole app-side integration is one call on launch, and again when a key is pasted:',
		'',
		'  const state = await cb.open(licenseKey, {',
		'    onChange: (next) => { if (next.decision === "deny") lock(next) },',
		'  })',
		'  if (state.decision === "deny") lock(state)',
		'',
		'Two rules you must not break:',
		'1. Branch on state.decision only. Every inconclusive answer (offline, 5xx, timeout, an',
		'   unknown key) already resolves to allow, so never lock a paying user out for one.',
		'2. Gate features on state.entitlements, which we sign. Never on state.license.plan or',
		'   .kind, which are display only and change when a vendor renames a tier.',
		'',
		'Do not write a refresh loop, a seat heartbeat, or instance-id bookkeeping. The SDK owns all',
		'three. Seats are enforced on our side and your app never counts them; the only thing that',
		'varies per licence is state.entitlements. Outside a browser you must pass durable storage,',
		'or the SDK throws — see the snippet for the adapter.',
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
				? 'Seats are a shared pool, and the SDK holds one while the app runs. This count is the product default; a price can buy more or fewer. Enforced on our side, so the app never counts them.'
				: 'Each seat binds to one machine until it is released. This count is the product default; a price can buy more or fewer. Enforced on our side, so the app never counts them.',
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
			method: 'POST',
			path: '/v1/keyset',
			what: 'Signing keys for whatever product a licence belongs to — no slug needed.',
		},
		{
			method: 'GET',
			path: `/v1/pubkey?product=${product.slug}`,
			what: 'The same keys by slug, for an integration that has one (already embedded above).',
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
	if (entries.length === 0) return '{ /* fetched by licence key on first open() */ }';
	const lines = entries.map(([kid, key]) => `\t\t'${kid}': '${key}',`);
	return `{\n${lines.join('\n')}\n\t}`;
}

/** The Swift dictionary form of the embedded keys. */
function swiftKeysLiteral(publicKeys: Record<string, string>): string {
	const entries = Object.entries(publicKeys);
	if (entries.length === 0) return '[:] // fetched by licence key on first open()';
	const lines = entries.map(([kid, key]) => `\t\t"${kid}": "${key}",`);
	return `[\n${lines.join('\n')}\n\t]`;
}

/**
 * A durable storage adapter, spelled out rather than described.
 *
 * The SDK throws at construction without one outside a browser, so a snippet that only warns about
 * storage is a snippet that does not run. Getting this wrong is also the likeliest way to hurt a
 * real customer: a fresh device id per launch takes another activation every time.
 *
 * Imports are per host rather than shared, because a snippet that pulls in something it never uses
 * and calls something it never imported is a snippet somebody deletes, storage and all.
 */
const FILE_STORAGE = (imports: string[], path: string): string =>
	[
		"import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
		"import { dirname } from 'node:path'",
		...imports,
		'',
		'// Survives restarts and updates, which is what keeps one activation to one machine.',
		`const file = ${path}`,
		'mkdirSync(dirname(file), { recursive: true })',
		'const read = (): Record<string, string> => {',
		"\ttry { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }",
		'}',
		'const store = {',
		'\tgetItem: (k: string) => read()[k] ?? null,',
		'\tsetItem: (k: string, v: string) => {',
		'\t\twriteFileSync(file, JSON.stringify({ ...read(), [k]: v }), { mode: 0o600 })',
		'\t},',
		'}',
	].join('\n');

/** The Tauri variant: an async store read once at startup, then written behind the cache. */
const TAURI_STORAGE = [
	"import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'",
	'',
	"const FILE = 'license.json'",
	'let cache: Record<string, string> = {}',
	'let queue: Promise<unknown> = Promise.resolve()',
	'',
	'// Call this once, before the client is used, or the first device id is not the durable one.',
	'export async function loadLicenseStore() {',
	'\ttry {',
	'\t\tcache = JSON.parse(await readTextFile(FILE, { baseDir: BaseDirectory.AppConfig }))',
	'\t} catch { cache = {} }',
	'}',
	'const store = {',
	'\tgetItem: (k: string) => cache[k] ?? null,',
	'\tsetItem: (k: string, v: string) => {',
	'\t\tcache[k] = v',
	'\t\t// Chained, not parallel: two overlapping writes can persist a stale snapshot.',
	'\t\tqueue = queue.then(() =>',
	'\t\t\twriteTextFile(FILE, JSON.stringify(cache), { baseDir: BaseDirectory.AppConfig }),',
	'\t\t)',
	'\t},',
	'}',
].join('\n');

function tsClient(
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
	needsStorage: boolean,
): string {
	return [
		`import { CoolBeans } from '@coolbeans/sdk'`,
		'',
		`const cb = new CoolBeans({`,
		`\tproduct: '${product.slug}',`,
		`\tbaseUrl: '${baseUrl}',`,
		`\t// Bundle the keys so the app verifies offline with no first-run network call.`,
		`\tpublicKeys: ${keysLiteral(publicKeys)},`,
		...(needsStorage ? ['\tstorage: store,'] : []),
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
	'// On sign-out, to give the seat back: await cb.release()',
	'// On shutdown, so nothing is left running: cb.stop()',
].join('\n');

function tsSnippet(
	target: Extract<SnippetTarget, 'node' | 'electron' | 'tauri' | 'browser'>,
	label: string,
	storageNote: string,
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
): Snippet {
	// Everything but the browser has to be handed durable storage, and the note above is the code
	// that provides it, so the client wires it up.
	const needsStorage = target !== 'browser';
	const code = [
		storageNote,
		'',
		tsClient(product, baseUrl, publicKeys, needsStorage),
		'',
		TS_OPEN,
	].join('\n');
	return { target, label, language: 'ts', install: 'npm i @coolbeans/sdk', code };
}

function swiftSnippet(
	product: Product,
	baseUrl: string,
	publicKeys: Record<string, string>,
): Snippet {
	// Identical for both seat models: the Swift SDK holds a floating seat itself, exactly as the
	// TypeScript one does, so there is nothing here for the app to schedule.
	const seat = '';
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
			FILE_STORAGE(
				["import { join } from 'node:path'", "import { homedir } from 'node:os'"],
				"join(homedir(), '.config', '<your-app>', 'license.json')",
			),
			product,
			baseUrl,
			publicKeys,
		),
		tsSnippet(
			'electron',
			'Electron (main)',
			[
				'// Licensing belongs in the main process, so the key never sits in web content.',
				FILE_STORAGE(
					["import { join } from 'node:path'", "import { app } from 'electron'"],
					"join(app.getPath('userData'), 'license.json')",
				),
			].join('\n'),
			product,
			baseUrl,
			publicKeys,
		),
		tsSnippet(
			'tauri',
			'Tauri',
			`// The Tauri store is async, so read it once at startup and keep it in memory.\n${TAURI_STORAGE}`,
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
