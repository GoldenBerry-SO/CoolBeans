// ABOUTME: Provider-event claim tests (PRD §13) — a redelivered event is processed exactly once.
// ABOUTME: A failed handler marks the row failed (#34): visible in the console, open to retry.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { claimEvent, claimOutcomeForRow, completeEvent, failEvent } from './payments.js';

let h: TestHarness;
const EVENT = { id: 'evt_1', provider: 'stripe', type: 'checkout.session.completed' };

beforeEach(async () => {
	h = await makeHarness();
});

async function eventRow() {
	const rows = await rawQuery<{ status: string; attempts: number; last_error: string | null }>(
		`SELECT status, attempts, last_error FROM provider_events WHERE id = '${EVENT.id}'`,
	);
	return rows[0];
}

describe('provider event claims', () => {
	it('only the first claimant may process an event', async () => {
		expect(await claimEvent(h.deps, EVENT)).toBe(true);
		// A concurrent redelivery arrives before the first finished.
		expect(await claimEvent(h.deps, EVENT)).toBe(false);
	});

	it('a completed event is never processed again', async () => {
		await claimEvent(h.deps, EVENT);
		await completeEvent(h.deps, EVENT.id);
		expect(await claimEvent(h.deps, EVENT)).toBe(false);
	});

	it('a failed claim stays visible and lets the provider retry re-enter (#34)', async () => {
		await claimEvent(h.deps, EVENT);
		await failEvent(h.deps, EVENT.id, undefined, new Error('email provider down'));
		// The failure is on the record — state, attempts, and what went wrong…
		expect(await eventRow()).toMatchObject({
			status: 'failed',
			attempts: 1,
			last_error: expect.stringContaining('email provider down') as string,
		});
		// …and the retry does not have to wait out the stale-claim window.
		expect(await claimEvent(h.deps, EVENT)).toBe(true);
	});

	it('counts every failure and keeps the latest error', async () => {
		await claimEvent(h.deps, EVENT);
		await failEvent(h.deps, EVENT.id, undefined, new Error('first crash'));
		await claimEvent(h.deps, EVENT);
		await failEvent(h.deps, EVENT.id, undefined, new Error('second crash'));
		expect(await eventRow()).toMatchObject({
			attempts: 2,
			last_error: expect.stringContaining('second crash') as string,
		});
	});

	it('a retry that succeeds after failures ends done, history intact', async () => {
		await claimEvent(h.deps, EVENT);
		await failEvent(h.deps, EVENT.id, undefined, new Error('transient'));
		await claimEvent(h.deps, EVENT);
		await completeEvent(h.deps, EVENT.id);
		expect(await eventRow()).toMatchObject({ status: 'done', attempts: 1 });
		expect(await claimEvent(h.deps, EVENT)).toBe(false);
	});

	it('the failure trail reaches the console events surface', async () => {
		await claimEvent(h.deps, EVENT);
		await failEvent(h.deps, EVENT.id, undefined, new Error('email provider down'));
		const res = await h.app.request('/admin/events', { headers: h.adminHeaders });
		const { events } = (await res.json()) as {
			events: Array<{ id: string; status: string; attempts: number; last_error: string | null }>;
		};
		const row = events.find((e) => e.id === EVENT.id);
		expect(row).toMatchObject({
			status: 'failed',
			attempts: 1,
			last_error: expect.stringContaining('email provider down') as string,
		});
	});

	it('reclaims an abandoned in-flight event so a crash cannot wedge it forever', async () => {
		await claimEvent(h.deps, EVENT);
		h.clock.advance(10 * 60_000);
		expect(await claimEvent(h.deps, EVENT)).toBe(true);
	});
});

describe('reading the event row after a refused claim', () => {
	// The interleaving that produces a missing row (another worker releasing between our
	// two statements) cannot be staged against a synchronous driver, so the decision is
	// tested directly — it is the part that would silently drop a delivery.
	it('treats a vanished row as retryable, never as finished', async () => {
		expect(claimOutcomeForRow(undefined)).toBe('in_flight');
	});

	it('still recognises a genuinely completed event', async () => {
		expect(claimOutcomeForRow({ status: 'done' })).toBe('done');
	});

	it('recognises another worker mid-flight', async () => {
		expect(claimOutcomeForRow({ status: 'processing' })).toBe('in_flight');
	});

	it('treats a freshly failed row as retryable', async () => {
		// Another worker failed it between our two statements; the provider's retry (or
		// ours) may take it straight back.
		expect(claimOutcomeForRow({ status: 'failed' })).toBe('in_flight');
	});
});
