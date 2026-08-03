// ABOUTME: Daily validation stats (issues #37, #101) — the Overview chart's real source.
// ABOUTME: Validate is the hot path, so recording must stay cheap and never block a check.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct, issueKey, post } from '../test/seed.js';
import { recentValidationCounts, recordValidation } from './validation-stats.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

function record(productId: number, licenseId = 1, refused = false) {
	return recordValidation(h.deps, { productId, licenseId, refused });
}

async function seedLicense(product = 'clementine'): Promise<string> {
	return issueKey(h.app, { product, email: 'b@x.test', kind: 'perpetual' });
}

describe('validation counters', () => {
	it('counts each check for the product on the day it happened', async () => {
		await seedLicense();
		await record(1);
		await record(1);
		await record(1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		const today = h.clock.now().toISOString().slice(0, 10);
		expect(days.find((d) => d.day === today)).toMatchObject({ checks: 3, refused: 0 });
	});

	it('counts distinct licences, which one chatty install cannot inflate (#101)', async () => {
		await seedLicense();
		await seedLicense();
		// Licence 1 launches the app five times; licence 2 once.
		for (let i = 0; i < 5; i += 1) await record(1, 1);
		await record(1, 2);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		const today = days[days.length - 1];
		expect(today).toMatchObject({ licenses: 2, checks: 6 });
	});

	it('splits refused checks out, so lapsed keys phoning home are visible (#101)', async () => {
		await seedLicense();
		await record(1, 1, false);
		await record(1, 1, true);
		await record(1, 1, true);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		expect(days[days.length - 1]).toMatchObject({ checks: 3, refused: 2 });
	});

	it('keeps products apart so a per-product chart is possible', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
		});
		await seedLicense();
		const hexKey = await seedLicense('hexis');
		expect(hexKey).toBeTruthy();
		await record(1, 1);
		await record(2, 2);
		await record(2, 2);
		const today = h.clock.now().toISOString().slice(0, 10);
		const latest = async (productId: number) => {
			const days = await recentValidationCounts(h.deps, { days: 16, productId });
			return days[days.length - 1];
		};
		expect(await latest(1)).toMatchObject({ day: today, checks: 1, licenses: 1 });
		expect(await latest(2)).toMatchObject({ day: today, checks: 2, licenses: 1 });

		// And with no product filter the chart totals them rather than picking one.
		const all = await recentValidationCounts(h.deps, { days: 16 });
		expect(all[all.length - 1]).toMatchObject({ day: today, checks: 3, licenses: 2 });
	});

	it('returns a full window with zeroes, so the chart has no gaps', async () => {
		await seedLicense();
		await record(1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		expect(days).toHaveLength(16);
		expect(days[days.length - 1]?.day).toBe(h.clock.now().toISOString().slice(0, 10));
		// Oldest first, so the chart reads left to right.
		expect(days[0]?.day < days[15]?.day).toBe(true);
		expect(days.slice(0, 15).every((d) => d.checks === 0 && d.licenses === 0)).toBe(true);
	});

	it('rolls over to a new row when the day changes', async () => {
		await seedLicense();
		await record(1);
		h.clock.advance(24 * 60 * 60 * 1000);
		await record(1);
		await record(1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		const counted = days.filter((d) => d.checks > 0);
		expect(counted).toHaveLength(2);
		expect(counted[0]).toMatchObject({ checks: 1, licenses: 1 });
		expect(counted[1]).toMatchObject({ checks: 2, licenses: 1 });
	});

	it('records through the public validate path, refusals included', async () => {
		const key = await seedLicense();
		// A check against a live seat answers valid; a bogus instance is a refusal.
		const activated = await post(h.app, '/v1/activate', {
			license_key: key,
			instance_name: 'mac',
		});
		const instanceId = (activated.body.instance as { id: string }).id;
		await post(h.app, '/v1/validate', { license_key: key, instance_id: instanceId });
		await post(h.app, '/v1/validate', { license_key: key, instance_id: 'unknown-instance' });
		const days = await recentValidationCounts(h.deps, { days: 16, productId: 1 });
		expect(days[days.length - 1]).toMatchObject({ checks: 2, refused: 1, licenses: 1 });
	});

	it('never fails the check when recording breaks', async () => {
		// A licence id that does not exist violates the seen-set FK; the check survives.
		await expect(
			recordValidation(h.deps, { productId: 1, licenseId: 999_999, refused: false }),
		).resolves.toBeUndefined();
	});
});
