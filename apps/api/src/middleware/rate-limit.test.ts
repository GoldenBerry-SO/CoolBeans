// ABOUTME: Rate-limit tests (PRD §18) — the public surface throttles; webhooks are never limited.
// ABOUTME: Uses the in-memory store with a low limit; keys per license key so tenants are isolated.

import { createLogger } from '@coolbeans/logger';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness, testConfig } from '../test/harness.js';
import { createProduct, issueKey } from '../test/seed.js';
import { publicRateLimiter } from './rate-limit.js';

let h: TestHarness;

beforeEach(async () => {
	h = makeHarness({
		rateLimit: publicRateLimiter({
			config: testConfig(),
			logger: createLogger({ level: 'error' }),
			perMinute: 3,
		}),
	});
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

async function validate(key: string) {
	const res = await h.app.request('/v1/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ license_key: key, instance_id: 'x' }),
	});
	return res.status;
}

describe('rate limiting', () => {
	it('throttles the public surface after the limit', async () => {
		const key = 'CLEM-A2B3-C4D5-E6F7-G8H9';
		const statuses = [];
		for (let i = 0; i < 5; i++) statuses.push(await validate(key));
		expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
	});

	it('does not limit the webhook path', async () => {
		// Many webhook calls in a row are never 429 (they are signature-protected instead).
		for (let i = 0; i < 6; i++) {
			const res = await h.app.request('/v1/stripe/webhook', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			});
			expect(res.status).not.toBe(429);
		}
	});
});

describe('per-key throttle (issue #39)', () => {
	it('throttles repeated failures against one key even as the IP rotates', async () => {
		const h = makeHarness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
		});
		const target = 'CLEM-AAAA-BBBB-CCCC-DDDD';

		// An attacker rotating IPs gets no help from the per-IP window; the key itself
		// has to carry the throttle.
		let lastStatus = 0;
		for (let i = 0; i < 12; i++) {
			const res = await h.app.request('/v1/activate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-real-ip': `10.0.0.${i}` },
				body: JSON.stringify({ license_key: target, instance_name: 'probe' }),
			});
			lastStatus = res.status;
		}
		expect(lastStatus).toBe(429);
	});

	it('a successful activation is never throttled by earlier failures elsewhere', async () => {
		const h = makeHarness();
		await createProduct(h.app, {
			slug: 'clementine',
			name: 'Clementine',
			key_prefix: 'CLEM',
			email_from: 'r@clementine.email',
		});
		const good = await issueKey(h.app, {
			product: 'clementine',
			email: 'buyer@example.com',
			tier: 'lifetime',
		});
		for (let i = 0; i < 12; i++) {
			await h.app.request('/v1/activate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-real-ip': `10.1.0.${i}` },
				body: JSON.stringify({ license_key: 'CLEM-ZZZZ-ZZZZ-ZZZZ-ZZZZ', instance_name: 'probe' }),
			});
		}
		const res = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.1.0.99' },
			body: JSON.stringify({ license_key: good, instance_name: 'Real device' }),
		});
		expect(res.status).toBe(200);
	});
});
