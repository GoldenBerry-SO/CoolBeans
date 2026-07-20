// ABOUTME: The offline token's expires_at carries a buffer past the licence expiry (issue #55).
// ABOUTME: It exists so a subscriber who renews while offline is not locked out by a stale token.

import type { License, Product } from '@coolbeans/db';
import { licenses, products, purchases } from '@coolbeans/db';
import { describe, expect, it } from 'vitest';
import type { TokenPayload } from '../domain/token.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { mintToken } from './signing.js';

const DAY = 86_400_000;

function seed(h: TestHarness, tier: 'lifetime' | 'yearly' | 'trial', expiresAt: string | null) {
	const product = h.deps.db
		.insert(products)
		.values({ slug: 'clementine', name: 'Clementine', keyPrefix: 'CLEM', emailFrom: 'r@c.io' })
		.returning()
		.get();
	const purchase = h.deps.db
		.insert(purchases)
		.values({ productId: product.id, provider: 'manual', email: 'b@c.io' })
		.returning()
		.get();
	const license = h.deps.db
		.insert(licenses)
		.values({
			productId: product.id,
			purchaseId: purchase.id,
			key: 'CLEMABCDEFGHJKMNPQRS',
			tier,
			expiresAt,
		})
		.returning()
		.get();
	return { product: product as Product, license: license as License };
}

/** Read a token's payload without verifying. The signature is covered by token.test.ts. */
function payloadOf(token: string): TokenPayload {
	const body = token.split('.')[1] ?? '';
	return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
}

function claimOf(h: TestHarness, tier: 'lifetime' | 'yearly' | 'trial', expiresAt: string | null) {
	const { product, license } = seed(h, tier, expiresAt);
	const { token } = mintToken(h.deps, {
		license,
		product,
		instanceId: 'inst-1',
		displayKey: 'CLEM-ABCD-EFGH-JKMN-PQRS',
	});
	return payloadOf(token);
}

describe('offline token expiry buffer', () => {
	it('pushes a yearly licence expiry out by the configured buffer', () => {
		// The client now treats a past expires_at as definitive, so the raw licence expiry
		// would lock out a subscriber who renewed while offline and holds a stale token.
		const h = makeHarness();
		const expiry = new Date(h.clock.now().getTime() + 30 * DAY).toISOString();
		const payload = claimOf(h, 'yearly', expiry);
		const claimed = new Date(payload.expires_at ?? '').getTime();
		expect(claimed).toBe(new Date(expiry).getTime() + 14 * DAY);
	});

	it('honours a custom buffer from config', () => {
		const h = makeHarness({ config: { offlineTokenBufferDays: 3 } });
		const expiry = new Date(h.clock.now().getTime() + 30 * DAY).toISOString();
		const payload = claimOf(h, 'yearly', expiry);
		const claimed = new Date(payload.expires_at ?? '').getTime();
		expect(claimed).toBe(new Date(expiry).getTime() + 3 * DAY);
	});

	it('leaves a lifetime licence with no expiry at all', () => {
		// A buffer applied to null would invent an expiry for a licence that has none.
		const h = makeHarness();
		expect(claimOf(h, 'lifetime', null).expires_at).toBeNull();
	});

	it('never extends a trial', () => {
		// A buffered trial is a longer trial. §9 says the token must not outlive it.
		const h = makeHarness();
		const expiry = new Date(h.clock.now().getTime() + 5 * DAY).toISOString();
		const payload = claimOf(h, 'trial', expiry);
		expect(new Date(payload.expires_at ?? '').getTime()).toBe(new Date(expiry).getTime());
	});

	it('still clamps a trial token TTL to the trial end', () => {
		const h = makeHarness();
		const expiry = new Date(h.clock.now().getTime() + 2 * DAY).toISOString();
		const payload = claimOf(h, 'trial', expiry);
		expect(payload.exp * 1000).toBeLessThanOrEqual(new Date(expiry).getTime());
	});

	it('does not modify the licence row', () => {
		// The buffer is a property of the token we hand out, not of the licence itself.
		const h = makeHarness();
		const expiry = new Date(h.clock.now().getTime() + 30 * DAY).toISOString();
		const { product, license } = seed(h, 'yearly', expiry);
		mintToken(h.deps, {
			license,
			product,
			instanceId: 'inst-1',
			displayKey: 'CLEM-ABCD-EFGH-JKMN-PQRS',
		});
		const row = h.deps.db.select().from(licenses).all()[0];
		expect(row?.expiresAt).toBe(expiry);
	});
});
