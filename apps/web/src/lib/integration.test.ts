// ABOUTME: The Integration builders (#61) pre-fill real product values and gate heartbeat on seat model.
// ABOUTME: Snippets/endpoints are the credential-free copy a developer pastes; this pins that contract.

import { describe, expect, it } from 'vitest';
import { agentPrompt, buildSnippets, configFacts, publicEndpoints } from './integration.js';
import type { Product } from './types.js';

function product(overrides: Partial<Product> = {}): Product {
	return {
		id: 1,
		slug: 'acme-app',
		name: 'Acme App',
		keyPrefix: 'ACME',
		activationLimit: 3,
		activationModel: 'node_locked',
		emailFrom: 'keys@acme.com',
		connected: false,
		stripeConnected: false,
		keysTotal: 0,
		keysActive: 0,
		...overrides,
	};
}

const BASE = 'https://app.coolbeans.tools';
const KEYS = { '1': 'MCowBQYDK2VwAyEA_fakekey_' };

describe('configFacts', () => {
	it('surfaces the real base url, slug and prefix', () => {
		const facts = configFacts(product(), BASE);
		const values = facts.map((f) => f.value).join(' | ');
		expect(values).toContain('acme-app');
		expect(values).toContain('ACME');
		expect(values).toContain(BASE);
	});

	it('marks the seat count as a product default, not a promise', () => {
		// A grant can sell three seats or ten from one product, so the number here is a default. It
		// does not tell an app to read the real one: nothing exposes it, and seats are ours to
		// enforce, which is why the hint says so instead.
		const seats = configFacts(product(), BASE).find((f) => f.label === 'Seat model');
		expect(seats?.hint).toMatch(/default/i);
		expect(seats?.hint).toMatch(/never counts them|enforced on our side/i);
	});

	it('does not tell the app to heartbeat, because the SDK does it', () => {
		const floating = configFacts(product({ activationModel: 'floating' }), BASE).find(
			(f) => f.label === 'Seat model',
		);
		expect(floating?.hint?.toLowerCase()).toContain('sdk');
	});

	it('describes the seat model in plain words, not the wire value', () => {
		const nodeLocked = configFacts(product(), BASE).find((f) => f.label === 'Seat model');
		expect(nodeLocked?.value).toContain('Per device');
		expect(nodeLocked?.value).not.toMatch(/node_locked|floating/);
		const floating = configFacts(product({ activationModel: 'floating' }), BASE).find(
			(f) => f.label === 'Seat model',
		);
		expect(floating?.value).toContain('Concurrent');
	});
});

describe('buildSnippets', () => {
	it('covers every framework the SDKs support', () => {
		const targets = buildSnippets(product(), BASE, KEYS).map((s) => s.target);
		expect(targets).toEqual(['node', 'electron', 'tauri', 'browser', 'swift']);
	});

	it('pre-fills every snippet with the product slug and base url, not placeholders', () => {
		for (const snippet of buildSnippets(product(), BASE, KEYS)) {
			expect(snippet.code, snippet.target).toContain('acme-app');
			expect(snippet.code, snippet.target).toContain(BASE);
		}
	});

	it('embeds the public keys with their kid so offline verify needs no network', () => {
		const node = buildSnippets(product(), BASE, KEYS).find((s) => s.target === 'node');
		expect(node?.code).toContain("'1'");
		expect(node?.code).toContain('MCowBQYDK2VwAyEA_fakekey_');
	});

	it('still produces a runnable snippet when no keys exist yet', () => {
		const node = buildSnippets(product(), BASE, {}).find((s) => s.target === 'node');
		// The SDK fetches and persists keys by licence key on the first open(), so an empty set is
		// valid. It says so, rather than leaving an empty object with no explanation.
		expect(node?.code).toMatch(/fetched by licence key/i);
		expect(node?.code).not.toContain("''");
	});

	it('asks a TypeScript app to do nothing about seats, whatever the model (#75)', () => {
		// The SDK holds a floating seat itself, on the cadence the server's lease implies. An
		// app-chosen heartbeat interval is the app deciding whether its own users get locked
		// out, so the snippet is identical for both models and mentions no cadence at all.
		for (const model of ['node_locked', 'floating'] as const) {
			const ts = buildSnippets(product({ activationModel: model }), BASE, KEYS).filter(
				(s) => s.target !== 'swift',
			);
			expect(ts.length).toBeGreaterThan(0);
			for (const s of ts) {
				expect(s.code.toLowerCase(), `${model} ${s.target}`).not.toContain('heartbeat');
				expect(s.code, `${model} ${s.target}`).toContain('cb.open(');
			}
		}
	});

	it('gives Swift the same one call and no seat work either (#77)', () => {
		// The Swift SDK holds the seat itself now, so the snippet is the same for both models —
		// same as TypeScript. Anything else would be the app choosing whether its users keep a
		// seat, which is the decision we took away on purpose.
		const swift = (model: 'node_locked' | 'floating') =>
			buildSnippets(product({ activationModel: model }), BASE, KEYS).find(
				(s) => s.target === 'swift',
			)?.code;
		expect(swift('floating')).toContain('cb.open(');
		expect(swift('node_locked')).toContain('cb.open(');
		expect(swift('floating')?.toLowerCase()).not.toContain('holdseat');
		expect(swift('floating')).toBe(swift('node_locked'));
	});

	it('gives every non-browser host storage that actually runs', () => {
		// The SDK now refuses to construct without durable storage outside a browser, so a snippet
		// that only comments about it is a snippet that throws when pasted. Each host gets an
		// adapter, because getting this wrong is what burns a customer's seats one restart at a
		// time.
		for (const target of ['node', 'electron', 'tauri'] as const) {
			const code = buildSnippets(product(), BASE, KEYS).find((s) => s.target === target)?.code;
			expect(code, target).toContain('storage:');
			expect(code, target).toMatch(/getItem/);
			expect(code, target).toMatch(/setItem/);
		}
		// The browser has localStorage, so asking for one there is noise.
		const browser = buildSnippets(product(), BASE, KEYS).find((s) => s.target === 'browser')?.code;
		expect(browser).not.toContain('storage:');
	});

	it('imports exactly what each snippet uses, so it compiles when pasted', () => {
		// The storage adapter is shared between hosts, and a shared import list means the Electron
		// snippet asked for homedir it never uses and never imported the `app` it calls. A snippet
		// that does not compile is a snippet somebody deletes, storage and all.
		const code = (target: 'node' | 'electron' | 'tauri') =>
			buildSnippets(product(), BASE, KEYS).find((s) => s.target === target)?.code ?? '';

		expect(code('node')).toContain("import { homedir } from 'node:os'");
		expect(code('node')).toContain('homedir()');

		expect(code('electron')).toContain("import { app } from 'electron'");
		expect(code('electron')).not.toContain('homedir');

		// Tauri's store is the plugin, so none of the node:fs imports belong there.
		expect(code('tauri')).not.toContain('node:fs');
		expect(code('tauri')).toContain('@tauri-apps/plugin-fs');
	});

	it('constructs with the product slug, since the console knows it', () => {
		// Optional in the SDK, but a console that has the slug and omits it hands a multi-product
		// vendor the one configuration where another product's key unlocks this app.
		for (const s of buildSnippets(product(), BASE, KEYS)) {
			expect(s.code, s.target).toMatch(/product: ["']acme-app["']/);
		}
	});

	it('never leaks a service secret: only the key is the credential', () => {
		for (const s of buildSnippets(product({ activationModel: 'floating' }), BASE, KEYS)) {
			const lower = s.code.toLowerCase();
			expect(lower, s.target).not.toContain('admin');
			expect(lower, s.target).not.toContain('bearer');
			expect(lower, s.target).not.toContain('secret');
		}
	});

	it('gives each SDK target its install line', () => {
		const snippets = buildSnippets(product(), BASE, KEYS);
		expect(snippets.find((s) => s.target === 'node')?.install).toBe('npm i @coolbeans/sdk');
		expect(snippets.find((s) => s.target === 'swift')?.install).toContain('coolbeans-swift');
	});
});

describe('agentPrompt', () => {
	it('points the agent at the hosted brief and guide with the real config', () => {
		const prompt = agentPrompt(product(), BASE);
		expect(prompt).toContain(`${BASE}/v1/integration/acme-app`);
		expect(prompt).toContain(`${BASE}/v1/llms.txt`);
		expect(prompt).toContain('acme-app');
	});

	it('carries the rules that matter even if the agent never opens the links', () => {
		// This block gets pasted into a coding agent. Some of them will write code from the prompt
		// alone, so the two things that cause real damage have to be in the prompt itself: locking
		// out a paying user on an inconclusive answer, and gating a feature on a plan label.
		const prompt = agentPrompt(product(), BASE);
		expect(prompt).toContain('open(');
		expect(prompt).toContain('decision');
		expect(prompt).toMatch(/never lock/i);
		expect(prompt).toContain('entitlements');
		expect(prompt).toMatch(/never .*plan|not .*plan/i);
	});

	it('does not hand the app any seat work, whatever the model', () => {
		// The SDK holds a floating seat itself, so the prompt is identical for both models and
		// tells the agent not to write one. Naming it beats staying silent: inventing a heartbeat
		// interval is the likeliest wrong move, and it is the app deciding whether users get
		// locked out.
		for (const model of ['node_locked', 'floating'] as const) {
			const prompt = agentPrompt(product({ activationModel: model }), BASE).toLowerCase();
			expect(prompt, model).toMatch(/do not write .*heartbeat/);
			expect(prompt, model).not.toContain('node_locked');
		}
		expect(agentPrompt(product({ activationModel: 'floating' }), BASE)).toBe(
			agentPrompt(product({ activationModel: 'node_locked' }), BASE),
		);
	});
});

describe('publicEndpoints', () => {
	it('lists the keyset route, which is how an app with no slug gets its keys (#73)', () => {
		const paths = publicEndpoints(product()).map((e) => e.path);
		expect(paths).toContain('/v1/keyset');
	});

	it('lists heartbeat only for a floating product and always points pubkey at the slug', () => {
		const locked = publicEndpoints(product());
		expect(locked.some((e) => e.path.includes('/v1/heartbeat'))).toBe(false);
		expect(locked.some((e) => e.path === '/v1/pubkey?product=acme-app')).toBe(true);

		const floating = publicEndpoints(product({ activationModel: 'floating' }));
		expect(floating.some((e) => e.path.includes('/v1/heartbeat'))).toBe(true);
	});
});
