// ABOUTME: Config tests — the seams and refusals that keep local convenience out of production.
// ABOUTME: STRIPE_API_BASE exists so journey tests can point the gateway at a local mock.

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
	ADMIN_TOKEN: 'a'.repeat(20),
	SIGNING_KEY_SECRET: 'b'.repeat(20),
} as NodeJS.ProcessEnv;

describe('STRIPE_API_BASE (journey tests, stripe-mock)', () => {
	it('is carried into config so the gateway can be pointed at a local mock', () => {
		const config = loadConfig({
			...base,
			STRIPE_SECRET_KEY: 'sk_test_123',
			STRIPE_API_BASE: 'http://localhost:12111',
		} as NodeJS.ProcessEnv);
		expect(config.stripe?.apiBase).toBe('http://localhost:12111');
	});

	it('is absent by default, so production always talks to the real Stripe', () => {
		const config = loadConfig({
			...base,
			STRIPE_SECRET_KEY: 'sk_test_123',
		} as NodeJS.ProcessEnv);
		expect(config.stripe?.apiBase).toBeUndefined();
	});
});
