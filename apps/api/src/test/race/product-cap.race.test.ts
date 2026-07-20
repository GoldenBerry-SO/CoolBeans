// ABOUTME: The Free-plan product cap under contention — concurrent creates must grant exactly one.
// ABOUTME: Two creates both reading 0/1 and both inserting is the read-then-write bug in cap form.

import { rowsOf } from '@coolbeans/db';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRaceHarness, type RaceHarness } from './harness.js';

let h: RaceHarness;
afterEach(async () => {
	await h.close();
});

describe('product cap under contention', () => {
	it('8 concurrent creates on a Free account produce exactly 1 product', async () => {
		// Billing configured is what makes limits real; a dedicated Free account keeps this
		// isolated from every other race file sharing the database.
		h = await makeRaceHarness({
			config: {
				billing: { stripeSecretKey: 'sk_test_race', proPriceId: 'price_race' },
			},
		});
		const [account] = rowsOf<{ id: number }>(
			await h.deps.db.execute(sql`
				INSERT INTO accounts (name, plan) VALUES ('race-cap.example', 'free') RETURNING id
			`),
		);
		// ADMIN_TOKEN resolves to the single self-host account; point this harness's admin
		// scope at the Free account via the header the middleware honours for that token.
		const headers = { ...h.adminHeaders, 'X-Coolbeans-Account': String(account.id) };

		const responses = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				h.app.request('/admin/products', {
					method: 'POST',
					headers,
					body: JSON.stringify({
						slug: `race-product-${i}`,
						name: `Race Product ${i}`,
						key_prefix: `RCP${'ABCDEFGH'[i]}`,
						email_from: 'r@c.io',
					}),
				}),
			),
		);

		const created = responses.filter((r) => r.status === 200).length;
		const refused = responses.filter((r) => r.status === 409).length;
		expect(created).toBe(1);
		expect(refused).toBe(7);

		const rows = rowsOf<{ n: number }>(
			await h.deps.db.execute(
				sql`SELECT COUNT(*)::int AS n FROM products WHERE account_id = ${account.id} AND archived_at IS NULL`,
			),
		);
		expect(rows[0].n).toBe(1);
	});
});
