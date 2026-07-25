// ABOUTME: Vitest configuration for the storage adapter — the migration itself is under test here.
// ABOUTME: Same PGlite headroom the API package needs, for the same reason.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// These tests boot PGlite (real Postgres in WASM) and apply every migration, which is
		// the point: the migration is the thing being tested. That costs ~1s cold plus the DDL,
		// and each added migration makes it longer, so vitest's 10s default hook timeout is a
		// ceiling this walks into on a cold CI runner — the suite then reports 14 skipped tests
		// and a timed-out beforeAll, which looks like a broken schema rather than a slow one.
		// A generous ceiling absorbs that without hiding a real hang: a genuinely stuck setup
		// still fails, just later.
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
