// ABOUTME: The Integration builders (#61) pre-fill real product values and gate heartbeat on seat model.
// ABOUTME: Snippets/endpoints are the credential-free copy a developer pastes; this pins that contract.

import { describe, expect, it } from 'vitest';
import { buildSnippets, configFacts, publicEndpoints } from './integration.js';
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
		stripePriceLifetime: null,
		stripePriceYearly: null,
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
		// The SDK fetches and persists keys on first verify, so an empty set is valid.
		expect(node?.code).toContain('/v1/pubkey');
		expect(node?.code).not.toContain("''");
	});

	it('only shows a heartbeat for a floating product', () => {
		for (const s of buildSnippets(product({ activationModel: 'node_locked' }), BASE, KEYS)) {
			expect(s.code.toLowerCase(), `node_locked ${s.target}`).not.toContain('heartbeat');
		}
		const floating = buildSnippets(product({ activationModel: 'floating' }), BASE, KEYS);
		for (const s of floating) {
			expect(s.code.toLowerCase(), `floating ${s.target}`).toContain('heartbeat');
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

describe('publicEndpoints', () => {
	it('lists heartbeat only for a floating product and always points pubkey at the slug', () => {
		const locked = publicEndpoints(product());
		expect(locked.some((e) => e.path.includes('/v1/heartbeat'))).toBe(false);
		expect(locked.some((e) => e.path === '/v1/pubkey?product=acme-app')).toBe(true);

		const floating = publicEndpoints(product({ activationModel: 'floating' }));
		expect(floating.some((e) => e.path.includes('/v1/heartbeat'))).toBe(true);
	});
});
