// ABOUTME: Retention prune (issue #49) — provider_events age out, audit_log never does.
// ABOUTME: The window matters: prune inside a provider's retry window and idempotency breaks.

import { providerEvents } from '@coolbeans/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../store/audit.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { PROVIDER_EVENT_RETENTION_DAYS, pruneProviderEvents } from './prune.js';

let h: TestHarness;

const DAY = 24 * 60 * 60 * 1000;

function seedEvent(id: string, ageDays: number) {
	const receivedAt = new Date(h.clock.now().getTime() - ageDays * DAY).toISOString();
	h.deps.db
		.insert(providerEvents)
		.values({
			id,
			provider: 'stripe',
			type: 'checkout.session.completed',
			status: 'done',
			receivedAt,
		})
		.run();
}

const remaining = () =>
	h.deps.db
		.select()
		.from(providerEvents)
		.all()
		.map((r) => r.id);

beforeEach(() => {
	h = makeHarness();
});

describe('pruneProviderEvents', () => {
	it('keeps anything a provider could still redeliver', () => {
		// Stripe gives up after ~3 days. Pruning inside that window would let a
		// redelivery re-run issuance and hand out a second key.
		seedEvent('evt_today', 0);
		seedEvent('evt_recent', 3);
		seedEvent('evt_edge', PROVIDER_EVENT_RETENTION_DAYS - 1);
		expect(pruneProviderEvents(h.deps)).toBe(0);
		expect(remaining()).toHaveLength(3);
	});

	it('drops rows well past every retry window', () => {
		seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 10);
		seedEvent('evt_fresh', 1);
		expect(pruneProviderEvents(h.deps)).toBe(1);
		expect(remaining()).toEqual(['evt_fresh']);
	});

	it('never prunes an event still in flight, however old the claim looks', () => {
		// A stuck 'processing' row is a bug worth seeing, not garbage to sweep away:
		// deleting it silently lets the same event run twice.
		const old = new Date(h.clock.now().getTime() - (PROVIDER_EVENT_RETENTION_DAYS + 30) * DAY);
		h.deps.db
			.insert(providerEvents)
			.values({
				id: 'evt_stuck',
				provider: 'stripe',
				type: 'charge.refunded',
				status: 'processing',
				receivedAt: old.toISOString(),
				claimedAt: old.toISOString(),
			})
			.run();
		expect(pruneProviderEvents(h.deps)).toBe(0);
		expect(remaining()).toEqual(['evt_stuck']);
	});

	it('leaves the audit log completely alone', () => {
		// "Who disabled this key" outliving the row is the whole point (ARCHITECTURE).
		writeAudit(h.deps.db, { action: 'license.disabled', actor: 'admin:someone@example.com' });
		seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 100);
		pruneProviderEvents(h.deps);
		// The original entry survives untouched. (The prune adds a row of its own, which
		// is why this checks the entry rather than the table's size.)
		const kept = h.deps.db.$client
			.prepare("SELECT actor FROM audit_log WHERE action = 'license.disabled'")
			.all() as Array<{ actor: string }>;
		expect(kept).toHaveLength(1);
		expect(kept[0]?.actor).toBe('admin:someone@example.com');
	});

	it('records what it pruned, so the trail explains the missing rows', () => {
		seedEvent('evt_ancient', PROVIDER_EVENT_RETENTION_DAYS + 5);
		pruneProviderEvents(h.deps);
		const row = h.deps.db.$client
			.prepare("SELECT actor, detail FROM audit_log WHERE action = 'provider_events.pruned'")
			.get() as { actor: string; detail: string } | undefined;
		expect(row).toBeDefined();
		expect(row?.actor).toBe('system');
		expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ deleted: 1 });
	});

	it('writes no audit row when there was nothing to prune', () => {
		seedEvent('evt_fresh', 1);
		expect(pruneProviderEvents(h.deps)).toBe(0);
		const n = h.deps.db.$client
			.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'provider_events.pruned'")
			.get() as { n: number };
		expect(n.n).toBe(0);
	});
});
