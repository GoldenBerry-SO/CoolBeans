// ABOUTME: The usage quota under contention — the one guarded statement expected to hold unchanged.
// ABOUTME: A single-row guarded UPDATE re-evaluates its WHERE under the row lock; this is the control.

import { rowsOf } from '@coolbeans/db';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { toDisplayKey } from '../../domain/keygen.js';
import { issueManual } from '../../services/issuance.js';
import { makeRaceHarness, type RaceHarness } from './harness.js';

let h: RaceHarness;
afterEach(async () => {
	await h.close();
});

describe('usage quota under contention', () => {
	it('40 concurrent increments against a limit of 10 accept exactly 10', async () => {
		h = await makeRaceHarness({ poolMax: 44 });
		const prefix = 'RUSE';
		const inserted = rowsOf<{ id: number }>(
			await h.deps.db.execute(sql`
				INSERT INTO products (account_id, slug, name, key_prefix, activation_limit, email_from)
				VALUES (1, 'race-usage', 'race-usage', ${prefix}, 50, 'r@c.io')
				RETURNING id
			`),
		);
		const productId = inserted[0].id;
		await h.deps.db.execute(sql`
			INSERT INTO metrics (product_id, key, display_name, default_limit, reset_period) VALUES (${productId}, 'exports', 'Exports', 10, 'monthly')
		`);
		const [productRow] = rowsOf<Record<string, unknown>>(
			await h.deps.db.execute(sql`SELECT * FROM products WHERE id = ${productId}`),
		);
		// Raw row into the narrow shape issuance actually reads; the cast is confined here.
		const product = {
			id: productRow.id,
			accountId: productRow.account_id,
			slug: productRow.slug,
			keyPrefix: productRow.key_prefix,
			emailFrom: productRow.email_from,
			archivedAt: null,
			// biome-ignore lint/suspicious/noExplicitAny: five fields stand in for a full Product row.
		} as any;
		const license = await issueManual(h.deps, {
			product,
			email: 'race@example.com',
			tier: 'lifetime',
			actor: 'race-test',
		});
		const key = toDisplayKey(license.key, prefix);
		const activated = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_name: 'meter' }),
		});
		const { instance } = (await activated.json()) as { instance: { id: string } };

		const responses = await Promise.all(
			Array.from({ length: 40 }, () =>
				h.app.request('/v1/usage/increment', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						license_key: key,
						instance_id: instance.id,
						metric: 'exports',
						delta: 1,
					}),
				}),
			),
		);

		const accepted = responses.filter((r) => r.status === 200).length;
		// Over-quota is 429 with a success-shaped body (§9), not 409 — the client is meant
		// to read current/limit off it, not treat it as a conflict.
		const refused = responses.filter((r) => r.status === 429).length;
		expect(accepted).toBe(10);
		expect(refused).toBe(30);

		const counter = rowsOf<{ current: number }>(
			await h.deps.db.execute(
				sql`SELECT current FROM usage_counters WHERE license_id = ${license.id}`,
			),
		);
		expect(counter[0].current).toBe(10);
	});
});
