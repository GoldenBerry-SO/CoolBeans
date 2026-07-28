// ABOUTME: Audit rows must carry the account they happened IN (issue #99) — a cloud vendor's
// ABOUTME: activations misfiled under the default account are invisible to them and leak to it.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { writeAuditBestEffort } from '../store/audit.js';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { createProduct, issueKey, post, signUp } from '../test/seed.js';

const cloud: Partial<Config> = {
	// Billing configured is what puts the instance in cloud mode: signup is open, so a
	// vendor account that is NOT the default account exists — the shape this bug needs.
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
	logMagicCodes: true,
};

let h: TestHarness;
let vendor: Record<string, string>;
let vendorAccountId: number;
let key: string;

beforeEach(async () => {
	h = await makeHarness({ config: cloud });
	vendor = await signUp(h.app, h.logger, 'chris@clementine.test', 'clementine');
	vendorAccountId = (
		await rawQuery<{ id: number }>("SELECT id FROM accounts WHERE name = 'clementine'")
	)[0].id;
	expect(vendorAccountId).not.toBe(1);
	await createProduct(
		h.app,
		{ slug: 'clementine', name: 'Clementine', key_prefix: 'CLEM', email_from: 'r@clem.test' },
		vendor,
	);
	key = await issueKey(
		h.app,
		{ product: 'clementine', email: 'buyer@x.test', kind: 'perpetual' },
		vendor,
	);
});

async function vendorFeedActions(): Promise<string[]> {
	const res = await h.app.request('/admin/audit', { headers: vendor });
	const { audit } = (await res.json()) as { audit: Array<{ action: string }> };
	return audit.map((a) => a.action);
}

async function auditAccountOf(action: string): Promise<number | undefined> {
	const rows = await rawQuery<{ account_id: number }>(
		`SELECT account_id FROM audit_log WHERE action = '${action}' ORDER BY id DESC LIMIT 1`,
	);
	return rows[0]?.account_id;
}

describe('audit rows land in the account they happened in', () => {
	it("files a manual issuance under the vendor's account, so their feed shows it", async () => {
		expect(await auditAccountOf('license.issued')).toBe(vendorAccountId);
		expect(await vendorFeedActions()).toContain('license.issued');
	});

	it("files an activation under the vendor's account, so their feed shows it", async () => {
		const r = await post(h.app, '/v1/activate', { license_key: key, instance_name: 'test-mac' });
		expect(r.status).toBe(200);
		expect(await auditAccountOf('activation.created')).toBe(vendorAccountId);
		expect(await vendorFeedActions()).toContain('activation.created');
	});

	it("files a deactivation under the vendor's account", async () => {
		const activated = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'test-mac',
		});
		const instanceId = (activated.body.instance as { id: string }).id;
		const r = await post(h.app, '/v1/deactivate', { license_key: key, instance_id: instanceId });
		expect(r.status).toBe(200);
		expect(await auditAccountOf('activation.deactivated')).toBe(vendorAccountId);
		expect(await vendorFeedActions()).toContain('activation.deactivated');
	});

	it("never leaks a vendor activation into another account's feed", async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'test-mac' });
		// Before this fix every public-path audit row defaulted to account 1 — filed under
		// a tenant that never owned the licence, and readable by them.
		const bystander = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
		const res = await h.app.request('/admin/audit', { headers: bystander });
		const { audit } = (await res.json()) as { audit: Array<{ action: string }> };
		expect(audit.map((a) => a.action)).not.toContain('activation.created');
	});

	it("files a swept trial expiry under the licence's account", async () => {
		const { sweepExpiredTrials } = await import('./sweep.js');
		await issueKey(
			h.app,
			{ product: 'clementine', email: 'trial@x.test', kind: 'trial', trial_days: 1 },
			vendor,
		);
		h.clock.advance(3 * 24 * 60 * 60 * 1000);
		expect(await sweepExpiredTrials(h.deps)).toBe(1);
		expect(await auditAccountOf('license.disabled')).toBe(vendorAccountId);
	});
});

describe('stats count recent activations (issue #99)', () => {
	it('reports activations_7d scoped to the account', async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'mac-one' });
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'mac-two' });
		const res = await h.app.request('/admin/stats', { headers: vendor });
		const { stats } = (await res.json()) as { stats: { activations_7d: number } };
		expect(stats.activations_7d).toBe(2);

		// Another account saw none of this traffic.
		const bystander = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
		const other = await h.app.request('/admin/stats', { headers: bystander });
		const otherStats = ((await other.json()) as { stats: { activations_7d: number } }).stats;
		expect(otherStats.activations_7d).toBe(0);
	});

	it('the client call survives an audit insert failure (activate is the frozen path)', async () => {
		// PRD §9: a customer whose seat committed must never see a 500 because the vendor's
		// activity trail hiccuped. The wrapper is what the activate path writes through.
		const logged: string[] = [];
		const throwingDb = {
			insert() {
				throw new Error('audit table is on fire');
			},
		};
		await expect(
			writeAuditBestEffort(
				throwingDb as never,
				{ error: (message: string) => void logged.push(message) },
				{ action: 'activation.created', actor: 'client', accountId: 1 },
			),
		).resolves.toBeUndefined();
		expect(logged.some((m) => /audit/i.test(m))).toBe(true);
	});

	it('does not count activations older than seven days', async () => {
		await post(h.app, '/v1/activate', { license_key: key, instance_name: 'old-mac' });
		h.clock.advance(8 * 24 * 60 * 60 * 1000);
		const res = await h.app.request('/admin/stats', { headers: vendor });
		const { stats } = (await res.json()) as { stats: { activations_7d: number } };
		expect(stats.activations_7d).toBe(0);
	});
});
