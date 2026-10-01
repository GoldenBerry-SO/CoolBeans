// ABOUTME: The worker must bound the completed and failed job history it leaves in Redis.
// ABOUTME: Unbounded, a 30s repeatable tick grows Redis by ~2,900 jobs a day until it is OOM-killed.

import { describe, expect, it } from 'vitest';
import { JOB_RETENTION } from './retention.js';

describe('worker job retention', () => {
	it('keeps a bounded number of completed jobs', () => {
		expect(JOB_RETENTION.removeOnComplete.count).toBeGreaterThan(0);
		expect(Number.isFinite(JOB_RETENTION.removeOnComplete.count)).toBe(true);
	});

	it('keeps failed jobs longer than completed ones, but still bounded', () => {
		expect(JOB_RETENTION.removeOnFail.count).toBeGreaterThanOrEqual(
			JOB_RETENTION.removeOnComplete.count,
		);
		expect(Number.isFinite(JOB_RETENTION.removeOnFail.count)).toBe(true);
		expect(JOB_RETENTION.removeOnFail.age).toBeGreaterThan(0);
	});
});
