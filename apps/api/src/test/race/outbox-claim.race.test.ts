// ABOUTME: The outbox drain under contention — two workers must never both claim one job.
// ABOUTME: A double-claimed send_key_email is a customer getting their licence twice.

import { rowsOf } from '@coolbeans/db';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { claimDue } from '../../services/outbox.js';
import { makeRaceHarness, type RaceHarness } from './harness.js';

let h: RaceHarness;
afterEach(async () => {
	await h.close();
});

describe('outbox claim under contention', () => {
	it('two concurrent drains split the queue with no overlap', async () => {
		h = await makeRaceHarness();
		for (let i = 0; i < 20; i++) {
			await h.deps.db.execute(sql`
				INSERT INTO outbox (kind, payload, status, run_after)
				VALUES ('send_key_email', ${`{"licenseId":${i}}`}, 'pending', ${new Date(0).toISOString()})
			`);
		}

		const [a, b] = await Promise.all([claimDue(h.deps, 20), claimDue(h.deps, 20)]);

		const idsA = new Set(a.map((j) => j.id));
		const overlap = b.filter((j) => idsA.has(j.id));
		// SKIP LOCKED means the second drain glides past what the first is claiming; the
		// old select-then-update handed both workers the same rows.
		expect(overlap).toHaveLength(0);
		expect(a.length + b.length).toBe(20);

		const claimed = rowsOf<{ n: number }>(
			await h.deps.db.execute(
				sql`SELECT COUNT(*)::int AS n FROM outbox WHERE status = 'processing'`,
			),
		);
		expect(claimed[0].n).toBe(20);
	});
});
