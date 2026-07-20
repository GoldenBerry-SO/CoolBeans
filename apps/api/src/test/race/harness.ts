// ABOUTME: Harness for race tests — a real postgres-js pool, so requests genuinely interleave.
// ABOUTME: Seeds via the same admin surface production uses; contention runs through HTTP.

import { createDb, createPool, type Database } from '@coolbeans/db';
import { inject } from 'vitest';
import { createApp } from '../../app.js';
import type { Config } from '../../config.js';
import type { AppDeps } from '../../deps.js';
import { resetKeyThrottle } from '../../services/key-throttle.js';
import { capturingEmail, capturingLogger, TEST_ADMIN_TOKEN, testConfig } from '../harness.js';

export interface RaceHarness {
	deps: AppDeps;
	app: ReturnType<typeof createApp>;
	adminHeaders: Record<string, string>;
	/** Close the pool. Every test must call this or the file hangs on exit. */
	close(): Promise<void>;
}

/**
 * Unlike the PGlite harness there is no per-test truncation: race files run one at a
 * time (fileParallelism false) and every test seeds its own uniquely-named product, so
 * isolation comes from the data, not from resets. What matters here is the pool size —
 * contention is the point, so every concurrent request must be able to hold a
 * connection at once.
 */
export async function makeRaceHarness(
	overrides: { config?: Partial<Config>; poolMax?: number } = {},
): Promise<RaceHarness> {
	resetKeyThrottle();
	const pool = createPool(inject('racePgUrl'), { max: overrides.poolMax ?? 16 });
	const db = createDb(pool) as unknown as Database;
	const deps: AppDeps = {
		db,
		config: testConfig(overrides.config),
		logger: capturingLogger(),
		email: capturingEmail(),
	};
	return {
		deps,
		app: createApp(deps),
		adminHeaders: {
			Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
			'Content-Type': 'application/json',
		},
		close: async () => {
			await pool.end({ timeout: 5 });
		},
	};
}
