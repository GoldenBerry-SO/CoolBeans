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
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

describe('global signing key fallback (PRD §11)', () => {
	it('signs product tokens with the global key instead of minting a per-product one', async () => {
		const globalId = await seedGlobalKey();
		const key = await getOrCreateActiveKey(h.deps, 1);
		expect(key.id).toBe(globalId);

		// No per-product key should have been created behind our back.
		const perProduct = await h.deps.db
			.select()
			.from(signingKeys)
			.where(eq(signingKeys.productId, 1));
		expect(perProduct).toHaveLength(0);
	});

	it('still mints a per-product key when no global key exists', async () => {
		const key = await getOrCreateActiveKey(h.deps, 1);
		expect(key.productId).toBe(1);
		const globals = await h.deps.db.select().from(signingKeys).where(isNull(signingKeys.productId));
		expect(globals).toHaveLength(0);
	});

	it('serves the global key in a product keyset so clients can verify its tokens', async () => {
		const globalId = await seedGlobalKey();
		await getOrCreateActiveKey(h.deps, 1);
		expect(Object.keys(await publicKeysFor(h.deps, 1))).toContain(String(globalId));
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
