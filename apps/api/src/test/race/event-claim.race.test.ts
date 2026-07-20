// ABOUTME: The webhook event claim under contention — one delivery may win, and the fence
// ABOUTME: handed back must be the winner's own, or a late completion acknowledges lost work.

import { rowsOf } from '@coolbeans/db';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { claimEventStatus, completeEvent } from '../../services/payments.js';
import { makeRaceHarness, type RaceHarness } from './harness.js';

let h: RaceHarness;
afterEach(async () => {
	await h.close();
});

describe('event claim under contention', () => {
	it('ten identical concurrent deliveries yield exactly one claim', async () => {
		h = await makeRaceHarness();
		const event = { id: 'evt_race_1', provider: 'stripe', type: 'checkout.session.completed' };

		const claims = await Promise.all(
			Array.from({ length: 10 }, () => claimEventStatus(h.deps, event)),
		);

		const winners = claims.filter((c) => c.result === 'claimed');
		expect(winners).toHaveLength(1);
		// Everyone else sees in_flight, never done: acknowledging an event another worker
		// still holds tells the provider to stop retrying, and a crash then loses the work.
		expect(claims.filter((c) => c.result === 'in_flight')).toHaveLength(9);

		const rows = rowsOf<{ n: number }>(
			await h.deps.db.execute(
				sql`SELECT COUNT(*)::int AS n FROM provider_events WHERE id = 'evt_race_1'`,
			),
		);
		expect(rows[0].n).toBe(1);
	});

	it('a stale takeover leaves the elder claimant with a dead fence', async () => {
		h = await makeRaceHarness();
		const event = { id: 'evt_race_2', provider: 'stripe', type: 'checkout.session.completed' };

		const elder = await claimEventStatus(h.deps, event);
		expect(elder.result).toBe('claimed');

		// Age the claim past the stale window, as a crashed worker's claim would be.
		await h.deps.db.execute(sql`
			UPDATE provider_events SET claimed_at = ${new Date(Date.now() - 10 * 60_000).toISOString()}
			WHERE id = 'evt_race_2'
		`);

		const successor = await claimEventStatus(h.deps, event);
		expect(successor.result).toBe('claimed');

		// The elder wakes up and completes with its own fence. It must bounce: its token
		// was superseded, and marking the row done would end the successor's retry cover.
		await completeEvent(h.deps, event.id, elder.token);
		const after = rowsOf<{ status: string }>(
			await h.deps.db.execute(sql`SELECT status FROM provider_events WHERE id = 'evt_race_2'`),
		);
		expect(after[0].status).toBe('processing');

		// The successor's own completion lands.
		await completeEvent(h.deps, event.id, successor.token);
		const done = rowsOf<{ status: string }>(
			await h.deps.db.execute(sql`SELECT status FROM provider_events WHERE id = 'evt_race_2'`),
		);
		expect(done[0].status).toBe('done');
	});
});
