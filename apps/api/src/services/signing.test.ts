// ABOUTME: Signing-key tests (PRD §11) — global-key fallback, verification keysets, boot validation.
// ABOUTME: A global key must actually be usable for product tokens, not just storable.

import { signingKeys } from '@coolbeans/db';
import { eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '../domain/crypto.js';
import { generateSigningKeyPair } from '../domain/token.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct } from '../test/seed.js';
import { assertSigningKeysUsable, getOrCreateActiveKey, publicKeysFor } from './signing.js';

let h: TestHarness;

/** Seed a global (product_id NULL) active signing key. */
async function seedGlobalKey(): Promise<number> {
	const pair = generateSigningKeyPair();
	const [row] = await h.deps.db
		.insert(signingKeys)
		.values({
			productId: null,
			publicKey: pair.publicKey,
			privateKey: encryptSecret(pair.privateKey, h.deps.config.signingKeySecret),
			active: true,
		})
		.returning();
	return row.id;
}

beforeEach(async () => {
	h = await makeHarness();
});

/** Create the test product. Called per test, AFTER any global key is seeded, because that is
 * the real operator order: one-keypair-for-everything is chosen at install, products come later. */
async function createClementine(): Promise<number> {
	const product = await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	return product.id as number;
}

describe('global signing key fallback (PRD §11)', () => {
	it('signs product tokens with the global key instead of minting a per-product one', async () => {
		const globalId = await seedGlobalKey();
		const productId = await createClementine();
		const key = await getOrCreateActiveKey(h.deps, productId);
		expect(key.id).toBe(globalId);

		// No per-product key should have been created behind our back — not by this call, and
		// not by product creation either, which respects the global key the same way.
		const perProduct = await h.deps.db
			.select()
			.from(signingKeys)
			.where(eq(signingKeys.productId, productId));
		expect(perProduct).toHaveLength(0);
	});

	it('mints a per-product key when no global key exists', async () => {
		const productId = await createClementine();
		const key = await getOrCreateActiveKey(h.deps, productId);
		expect(key.productId).toBe(productId);
		const globals = await h.deps.db.select().from(signingKeys).where(isNull(signingKeys.productId));
		expect(globals).toHaveLength(0);
	});

	it('serves the global key in a product keyset so clients can verify its tokens', async () => {
		const globalId = await seedGlobalKey();
		const productId = await createClementine();
		await getOrCreateActiveKey(h.deps, productId);
		expect(Object.keys(await publicKeysFor(h.deps, productId))).toContain(String(globalId));
	});
});

describe('signing keys exist from the moment the product does (#96)', () => {
	it('serves a keyset for a freshly created product, before any licence exists', async () => {
		// Keys used to mint on the first successful validate, so a vendor embedding the public
		// key at build time — the recommended setup, and what the Integration page offers to
		// copy — found "keys": {} until some customer had already activated. Two integrating
		// agents hit that window in one week.
		await createClementine();
		const res = await h.app.request('/v1/pubkey?product=clementine');
		const body = (await res.json()) as { keys: Record<string, string> };
		expect(Object.keys(body.keys).length).toBeGreaterThan(0);
	});

	it('does not mint a product key at creation when a global key serves everything', async () => {
		await seedGlobalKey();
		const productId = await createClementine();
		const perProduct = await h.deps.db
			.select()
			.from(signingKeys)
			.where(eq(signingKeys.productId, productId));
		expect(perProduct).toHaveLength(0);
		// The keyset is still non-empty: the global key serves this product's tokens.
		const res = await h.app.request('/v1/pubkey?product=clementine');
		const body = (await res.json()) as { keys: Record<string, string> };
		expect(Object.keys(body.keys).length).toBeGreaterThan(0);
	});

	it('keeps the lazy backstop for products created before this shipped', async () => {
		// Simulate an old product: create, then delete the eagerly minted key.
		const productId = await createClementine();
		await h.deps.db.delete(signingKeys).where(eq(signingKeys.productId, productId));
		const key = await getOrCreateActiveKey(h.deps, productId);
		expect(key.productId).toBe(productId);
	});
});

describe('boot validation (ARCHITECTURE: fail fast)', () => {
	it('passes when every stored key decrypts with the configured secret', async () => {
		await seedGlobalKey();
		await expect(assertSigningKeysUsable(h.deps)).resolves.not.toThrow();
	});

	it('fails loudly when the secret cannot decrypt a stored key', async () => {
		await seedGlobalKey();
		const wrong = { ...h.deps, config: { ...h.deps.config, signingKeySecret: 'x'.repeat(32) } };
		await expect(assertSigningKeysUsable(wrong)).rejects.toThrow(/SIGNING_KEY_SECRET/);
	});
});
