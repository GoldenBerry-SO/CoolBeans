// ABOUTME: Retention prune (issue #49) — provider_events age out, audit_log never does.
// ABOUTME: The window matters: prune inside a provider's retry window and idempotency breaks.

import { providerEvents, webhookDeliveries, webhookEndpoints } from '@coolbeans/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../store/audit.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import {
	PROVIDER_EVENT_RETENTION_DAYS,
	pruneProviderEvents,
	pruneWebhookDeliveries,
	WEBHOOK_DELIVERY_RETENTION_DAYS,
} from './prune.js';

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

describe('pruneWebhookDeliveries', () => {
	/** An endpoint to hang deliveries off; the FK requires one. */
	async function seedEndpoint(): Promise<number> {
		const [row] = await h.deps.db
			.insert(webhookEndpoints)
			.values({
				accountId: 1,
				url: 'https://vendor.example.com/hook',
				events: JSON.stringify(['license.issued']),
				secret: 'cbw_seeded',
			})
			.returning({ id: webhookEndpoints.id });
		if (!row) throw new Error('no endpoint');
		return row.id;
	}

	async function seedDelivery(
		endpointId: number,
		status: 'pending' | 'delivered' | 'failed',
		ageDays: number,
	): Promise<number> {
		const createdAt = new Date(h.clock.now().getTime() - ageDays * DAY).toISOString();
		const [row] = await h.deps.db
			.insert(webhookDeliveries)
			.values({
				endpointId,
				eventType: 'license.issued',
				payload: JSON.stringify({ buyer: { email: 'buyer@example.test' } }),
				status,
				createdAt,
			})
			.returning({ id: webhookDeliveries.id });
		if (!row) throw new Error('no delivery');
		return row.id;
	}

	const statuses = async () =>
		(await h.deps.db.select().from(webhookDeliveries)).map((r) => r.status).sort();

	it('keeps a finished delivery that is still inside the window', async () => {
		const e = await seedEndpoint();
		await seedDelivery(e, 'delivered', 0);
		await seedDelivery(e, 'failed', WEBHOOK_DELIVERY_RETENTION_DAYS - 1);
		expect(await pruneWebhookDeliveries(h.deps)).toBe(0);
		expect(await statuses()).toEqual(['delivered', 'failed']);
	});

	it('drops delivered and failed deliveries past the window', async () => {
		// The stored payload is the reason this matters: it is the whole event body, and
		// once buyers ride in it that is personal data we should not keep forever.
		const e = await seedEndpoint();
		await seedDelivery(e, 'delivered', WEBHOOK_DELIVERY_RETENTION_DAYS + 1);
		await seedDelivery(e, 'failed', WEBHOOK_DELIVERY_RETENTION_DAYS + 40);
		await seedDelivery(e, 'delivered', 1);
		expect(await pruneWebhookDeliveries(h.deps)).toBe(2);
		expect(await statuses()).toEqual(['delivered']);
	});

	it('never prunes a pending delivery, however old it looks', async () => {
		// A pending row still owes a retry, and the body cannot be rebuilt: the licence may
		// have been disabled since, and at-least-once has to send the event as it was.
		const e = await seedEndpoint();
		await seedDelivery(e, 'pending', WEBHOOK_DELIVERY_RETENTION_DAYS + 365);
		expect(await pruneWebhookDeliveries(h.deps)).toBe(0);
		expect(await statuses()).toEqual(['pending']);
	});

	it('records what it pruned, and stays quiet when it pruned nothing', async () => {
		const e = await seedEndpoint();
		await seedDelivery(e, 'delivered', WEBHOOK_DELIVERY_RETENTION_DAYS + 5);
		await pruneWebhookDeliveries(h.deps);
		const [row] = await rawQuery<{ actor: string; detail: string }>(
			"SELECT actor, detail FROM audit_log WHERE action = 'webhook_deliveries.pruned'",
		);
		expect(row?.actor).toBe('system');
		expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ deleted: 1 });

		expect(await pruneWebhookDeliveries(h.deps)).toBe(0);
		const [n] = await rawQuery<{ n: number }>(
			"SELECT COUNT(*) n FROM audit_log WHERE action = 'webhook_deliveries.pruned'",
		);
		expect(Number(n.n)).toBe(1);
	});

	it('actually runs from the sweep, and is counted in what it reports', async () => {
		// Without this the prune is dead code that still passes every test above: nothing in
		// production calls it directly, only runSweeps does.
		const { runSweeps } = await import('./sweep.js');
		const e = await seedEndpoint();
		await seedDelivery(e, 'delivered', WEBHOOK_DELIVERY_RETENTION_DAYS + 2);
		await seedDelivery(e, 'pending', WEBHOOK_DELIVERY_RETENTION_DAYS + 2);

		const result = await runSweeps(h.deps);

		expect(result.pruned).toBe(1);
		expect(await statuses()).toEqual(['pending']);
	});

	it('shares one retention window with the provider-event prune', async () => {
		// Two retention policies for "rows we only needed briefly" is a policy to forget to
		// change in one place.
		expect(WEBHOOK_DELIVERY_RETENTION_DAYS).toBe(PROVIDER_EVENT_RETENTION_DAYS);
	});
});
