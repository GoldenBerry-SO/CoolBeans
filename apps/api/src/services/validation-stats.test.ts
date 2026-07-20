// ABOUTME: Daily validation counts (issue #37) — the Overview chart's real source.
// ABOUTME: Validate is the hot path, so this must be one cheap upsert and never block a check.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../test/harness.js';
import { createProduct } from '../test/seed.js';
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

describe('validation counters', () => {
	it('counts each validation for the product on the day it happened', async () => {
		await recordValidation(h.deps, 1);
		await recordValidation(h.deps, 1);
		await recordValidation(h.deps, 1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		const today = h.clock.now().toISOString().slice(0, 10);
		expect(days.find((d) => d.day === today)?.count).toBe(3);
	});

	it('keeps products apart so a per-product chart is possible', async () => {
		await createProduct(h.app, {
			slug: 'hexis',
			name: 'Hexis',
			key_prefix: 'HEX',
			email_from: 'r@hexis.app',
		});
		await recordValidation(h.deps, 1);
		await recordValidation(h.deps, 2);
		await recordValidation(h.deps, 2);
		const today = h.clock.now().toISOString().slice(0, 10);
		const latest = async (productId: number) => {
			const days = await recentValidationCounts(h.deps, { days: 16, productId });
			return days[days.length - 1];
		};
		expect(await latest(1)).toMatchObject({ day: today, count: 1 });
		expect(await latest(2)).toMatchObject({ day: today, count: 2 });

		// And with no product filter the chart totals them rather than picking one.
		const all = await recentValidationCounts(h.deps, { days: 16 });
		expect(all[all.length - 1]).toMatchObject({ day: today, count: 3 });
	});

	it('returns a full window with zeroes, so the chart has no gaps', async () => {
		await recordValidation(h.deps, 1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		expect(days).toHaveLength(16);
		expect(days[days.length - 1]?.day).toBe(h.clock.now().toISOString().slice(0, 10));
		// Oldest first, so the chart reads left to right.
		expect(days[0]?.day < days[15]?.day).toBe(true);
		expect(days.slice(0, 15).every((d) => d.count === 0)).toBe(true);
	});

	it('rolls over to a new row when the day changes', async () => {
		await recordValidation(h.deps, 1);
		h.clock.advance(24 * 60 * 60 * 1000);
		await recordValidation(h.deps, 1);
		await recordValidation(h.deps, 1);
		const days = await recentValidationCounts(h.deps, { days: 16 });
		const counted = days.filter((d) => d.count > 0);
		expect(counted).toHaveLength(2);
		expect(counted[0]?.count).toBe(1);
		expect(counted[1]?.count).toBe(2);
	});
});
