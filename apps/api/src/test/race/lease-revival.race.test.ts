// ABOUTME: Floating-lease revival under contention — one free seat, many lapsed leases racing.
// ABOUTME: Exactly one revival may win, or a licence quietly holds more seats than were sold.

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

describe('lease revival under contention', () => {
	it('five lapsed leases racing one free seat revive exactly one', async () => {
		h = await makeRaceHarness();
		const prefix = 'RLEAS';
		const inserted = rowsOf<{ id: number }>(
			await h.deps.db.execute(sql`
				INSERT INTO products (account_id, slug, name, key_prefix, activation_limit,
					activation_model, floating_lease_minutes, email_from)
				VALUES (1, 'race-leases', 'race-leases', ${prefix}, 1, 'floating', 30, 'r@c.io')
				RETURNING id
			`),
		);
		const [productRow] = rowsOf<Record<string, unknown>>(
			await h.deps.db.execute(sql`SELECT * FROM products WHERE id = ${inserted[0].id}`),
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

		// Five instances whose leases all lapsed an hour ago. The seat pool is 1, so at most
		// one of them may come back without re-activating.
		const lapsed = new Date(Date.now() - 3_600_000).toISOString();
		for (let i = 0; i < 5; i++) {
			await h.deps.db.execute(sql`
				INSERT INTO activations (instance_id, license_id, name, created_at, lease_expires_at)
				VALUES (${`inst-${i}`}, ${license.id}, ${`machine-${i}`}, ${lapsed}, ${lapsed})
			`);
		}

		const responses = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				h.app.request('/v1/heartbeat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ license_key: key, instance_id: `inst-${i}` }),
				}),
			),
		);

		const bodies = await Promise.all(
			responses.map(async (r) => (await r.json()) as { lease_expires_at: string | null }),
		);
		const revived = bodies.filter((b) => b.lease_expires_at !== null).length;
		expect(revived).toBe(1);

		// And the table holds exactly one live lease for this licence.
		const live = rowsOf<{ n: number }>(
			await h.deps.db.execute(sql`
				SELECT COUNT(*)::int AS n FROM activations
				WHERE license_id = ${license.id} AND deactivated_at IS NULL
					AND lease_expires_at > ${new Date().toISOString()}
			`),
		);
		expect(live[0].n).toBe(1);
	});
});
