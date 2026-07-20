// ABOUTME: The seat cap under real contention — N concurrent activates must grant exactly the limit.
// ABOUTME: scripts/postgres/atomicity.mjs proved the unlocked form over-allocates; this pins the fix.

import { activations, licenses, rowsOf } from '@coolbeans/db';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { toDisplayKey } from '../../domain/keygen.js';
import { issueManual } from '../../services/issuance.js';
import { makeRaceHarness, type RaceHarness } from './harness.js';

let h: RaceHarness;
afterEach(async () => {
	await h.close();
});

async function seedNodeLocked(slug: string, prefix: string, activationLimit: number) {
	const rows = rowsOf<{ id: number }>(
		await h.deps.db.execute(sql`
			INSERT INTO products (account_id, slug, name, key_prefix, activation_limit, email_from)
			VALUES (1, ${slug}, ${slug}, ${prefix}, ${activationLimit}, 'r@c.io')
			RETURNING id
		`),
	);
	const [product] = rowsOf<Record<string, unknown>>(
		await h.deps.db.execute(sql`SELECT * FROM products WHERE id = ${rows[0].id}`),
	);
	// Through the real issuance path so the key is normalized exactly as production keys are.
	const license = await issueManual(h.deps, {
		// biome-ignore lint/suspicious/noExplicitAny: raw row into the Product shape the service reads.
		product: camel(product) as any,
		email: 'race@example.com',
		tier: 'lifetime',
		actor: 'race-test',
	});
	return { key: toDisplayKey(license.key, prefix), licenseId: license.id };
}

/** snake_case row → the camelCase shape services read. Only the fields issuance touches. */
function camel(row: Record<string, unknown>) {
	return {
		id: row.id,
		accountId: row.account_id,
		slug: row.slug,
		name: row.name,
		keyPrefix: row.key_prefix,
		activationLimit: row.activation_limit,
		activationModel: row.activation_model,
		floatingLeaseMinutes: row.floating_lease_minutes,
		emailFrom: row.email_from,
		archivedAt: row.archived_at,
	};
}

describe('seat cap under contention', () => {
	it('12 concurrent activations on a 3-seat licence grant exactly 3', async () => {
		h = await makeRaceHarness();
		const { key, licenseId } = await seedNodeLocked('race-seats', 'RSEAT', 3);

		const responses = await Promise.all(
			Array.from({ length: 12 }, (_, i) =>
				h.app.request('/v1/activate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ license_key: key, instance_name: `machine-${i}` }),
				}),
			),
		);

		const granted = responses.filter((r) => r.status === 200).length;
		const refused = responses.filter((r) => r.status === 409).length;
		expect(granted).toBe(3);
		expect(refused).toBe(9);

		// The database agrees with the HTTP answers — the cap held in the table itself.
		const live = rowsOf<{ n: number }>(
			await h.deps.db.execute(sql`
				SELECT COUNT(*)::int AS n FROM ${activations} a
				JOIN ${licenses} l ON l.id = a.license_id
				WHERE a.deactivated_at IS NULL AND l.id = ${licenseId}
			`),
		);
		expect(live[0].n).toBe(3);
	});
});
