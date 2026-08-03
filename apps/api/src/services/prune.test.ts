// ABOUTME: Retention prune (issue #49) — provider_events age out, audit_log never does.
// ABOUTME: The window matters: prune inside a provider's retry window and idempotency breaks.

import { providerEvents } from '@coolbeans/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../store/audit.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { PROVIDER_EVENT_RETENTION_DAYS, pruneProviderEvents } from './prune.js';

let h: TestHarness;

const DAY = 24 * 60 * 60 * 1000;

async function seedEvent(id: string, ageDays: number) {
	const receivedAt = new Date(h.clock.now().getTime() - ageDays * DAY).toISOString();
	await h.deps.db.insert(providerEvents).values({
		id,
		provider: 'stripe',
		type: 'checkout.session.completed',
		status: 'done',
		receivedAt,
	});
}

const remaining = async () => (await h.deps.db.select().from(providerEvents)).map((r) => r.id);

beforeEach(async () => {
	h = await makeHarness();
});

describe('pruneProviderEvents', () => {
	it('keeps anything a provider could still redeliver', async () => {
		// Stripe gives up after ~3 days. Pruning inside that window would let a
		// redelivery re-run issuance and hand out a second key.
		await seedEvent('evt_today', 0);
		await seedEvent('evt_recent', 3);
		await seedEvent('evt_edge', PROVIDER_EVENT_RETENTION_DAYS - 1);
		expect(await pruneProviderEvents(h.deps)).toBe(0);
		expect(await remaining()).toHaveLength(3);
	});

	it('drops rows well past every retry window', async () => {
		await seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 10);
		await seedEvent('evt_fresh', 1);
		expect(await pruneProviderEvents(h.deps)).toBe(1);
		expect(await remaining()).toEqual(['evt_fresh']);
	});

	it('never prunes an event still in flight, however old the claim looks', async () => {
		// A stuck 'processing' row is a bug worth seeing, not garbage to sweep away:
		// deleting it silently lets the same event run twice.
		const old = new Date(h.clock.now().getTime() - (PROVIDER_EVENT_RETENTION_DAYS + 30) * DAY);
		await h.deps.db.insert(providerEvents).values({
			id: 'evt_stuck',
			provider: 'stripe',
			type: 'charge.refunded',
			status: 'processing',
			receivedAt: old.toISOString(),
			claimedAt: old.toISOString(),
		});
		expect(await pruneProviderEvents(h.deps)).toBe(0);
		expect(await remaining()).toEqual(['evt_stuck']);
	});

	it('leaves the audit log completely alone', async () => {
		// "Who disabled this key" outliving the row is the whole point (ARCHITECTURE).
		await writeAudit(h.deps.db, {
			action: 'license.disabled',
			actor: 'admin:someone@example.com',
			accountId: 1,
		});
		await seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 100);
		await pruneProviderEvents(h.deps);
		// The original entry survives untouched. (The prune adds a row of its own, which
		// is why this checks the entry rather than the table's size.)
		const kept = await rawQuery<{ actor: string }>(
			"SELECT actor FROM audit_log WHERE action = 'license.disabled'",
		);
		expect(kept).toHaveLength(1);
		expect(kept[0]?.actor).toBe('admin:someone@example.com');
	});

	it('records what it pruned, so the trail explains the missing rows', async () => {
		await seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 5);
		await pruneProviderEvents(h.deps);
		const [row] = await rawQuery<{ actor: string; detail: string }>(
			"SELECT actor, detail FROM audit_log WHERE action = 'provider_events.pruned'",
		);
		expect(row).toBeDefined();
		expect(row?.actor).toBe('system');
		expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ deleted: 1 });
	});

	it('writes no audit row when there was nothing to prune', async () => {
		await seedEvent('evt_fresh', 1);
		expect(await pruneProviderEvents(h.deps)).toBe(0);
		const [n] = await rawQuery<{ n: number }>(
			"SELECT COUNT(*) n FROM audit_log WHERE action = 'provider_events.pruned'",
		);
		// Postgres COUNT(*) comes back as a bigint the driver serialises to a string.
		expect(Number(n.n)).toBe(0);
	});
});
