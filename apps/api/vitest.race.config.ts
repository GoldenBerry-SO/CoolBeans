// ABOUTME: Vitest project for the race suite — real Postgres, real pools, genuine interleaving.
// ABOUTME: Run with `pnpm test:race`; kept out of the default suite so `pnpm test` needs no Docker.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/test/race/**/*.race.test.ts'],
		globalSetup: ['src/test/race/setup.ts'],
		// One file at a time: each race stages precise contention against shared tables,
		// and a second file's load would turn a deterministic assertion into a flaky one.
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
