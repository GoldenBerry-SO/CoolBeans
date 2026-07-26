// ABOUTME: The agent guide + product brief (#64) carry the frozen contract and real config,
// ABOUTME: gate the heartbeat on seat model, and never leak a secret. This pins that contract.

import { describe, expect, it } from 'vitest';
import { type BriefProduct, buildAgentGuide, buildProductBrief } from './integration-brief.js';

function product(overrides: Partial<BriefProduct> = {}): BriefProduct {
	return {
		slug: 'acme-app',
		name: 'Acme App',
		keyPrefix: 'ACME',
		activationModel: 'node_locked',
		activationLimit: 3,
		...overrides,
	};
}

const BASE = 'https://app.coolbeans.tools';
const GUIDE = `${BASE}/v1/llms.txt`;
const KEYS = { '1': 'MCowBQYDK2VwAyEA_fakekey_' };

describe('buildAgentGuide', () => {
	const guide = buildAgentGuide();

	it('states the offline contract that must never be broken', () => {
		expect(guide).toContain('404');
		expect(guide).toMatch(/disabled/i);
		expect(guide).toMatch(/never lock/i);
	});

	it('documents the public endpoints and both SDK installs', () => {
		for (const path of ['/v1/activate', '/v1/validate', '/v1/heartbeat', '/v1/pubkey']) {
			expect(guide, path).toContain(path);
		}
		expect(guide).toContain('npm i @coolbeans/sdk');
		expect(guide).toContain('coolbeans-swift');
	});

	it('explains both seat models', () => {
		expect(guide).toMatch(/per device|node-locked/i);
		expect(guide).toMatch(/concurrent|floating/i);
	});

	it('teaches the one-call shape, and nothing that no longer exists (#75)', () => {
		expect(guide).toContain('open(');
		expect(guide).toContain('decision');
		// start({ heartbeatMs }) is gone: the SDK holds a floating seat on the cadence the
		// server's own lease implies. A guide naming a deleted method sends a coding agent off
		// to write code that throws, which is worse than saying nothing.
		expect(guide).not.toContain('cb.start(');
		expect(guide).not.toContain('heartbeatMs');
	});

	it('tells a TypeScript app it has no seat scheduling to do (#75)', () => {
		const floatingAdvice = guide.slice(guide.toLowerCase().indexOf('seat model'));
		expect(floatingAdvice).toMatch(/the SDK|itself|on its own/i);
	});
});

describe('buildProductBrief', () => {
	it('pre-fills the real config and links to the guide', () => {
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(brief).toContain('acme-app');
		expect(brief).toContain('ACME');
		expect(brief).toContain(BASE);
		expect(brief).toContain(GUIDE);
	});

	it('embeds the public keys with their kid', () => {
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(brief).toContain('"1"');
		expect(brief).toContain('MCowBQYDK2VwAyEA_fakekey_');
	});

	it('falls back to the pubkey fetch note when no keys exist yet', () => {
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: {},
			guideUrl: GUIDE,
		});
		expect(brief).toContain('/v1/pubkey?product=acme-app');
		expect(brief.toLowerCase()).toContain('first verify');
	});

	it('only mentions the heartbeat for a floating product', () => {
		const locked = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(locked.toLowerCase()).not.toContain('/v1/heartbeat');
		expect(locked).toMatch(/not needed/i);

		const floating = buildProductBrief({
			product: product({ activationModel: 'floating' }),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(floating).toContain('/v1/heartbeat');
		expect(floating.toLowerCase()).toContain('heartbeat');
	});

	it('never leaks a service secret: only public config appears', () => {
		const brief = buildProductBrief({
			product: product({ activationModel: 'floating' }),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		// No API keys, webhook secrets, or bearer tokens: the license key is the credential.
		expect(brief).not.toMatch(/sk_|whsec_|Bearer |ADMIN_TOKEN/);
	});
});
