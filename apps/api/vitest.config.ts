// ABOUTME: Vitest configuration for the API app — Node environment unit and handler tests.
// ABOUTME: Handler tests drive the app via app.request; the DB is PGlite (see src/test/pg.ts).

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// The race suite needs a real Postgres server and its own globalSetup; it runs via
		// vitest.race.config.ts (`pnpm test:race`), never here — PGlite is one connection
		// and cannot stage the contention those tests exist to prove.
		exclude: ['**/node_modules/**', 'src/test/race/**'],
		// Each file spins up its own PGlite (real Postgres in WASM): a cold instance plus the
		// migrations costs ~1s, and when many files boot at once that setup contends for CPU
		// and can blow past vitest's 5s default, failing a test that is actually fine and
		// passes on a rerun. A generous ceiling absorbs the contention spike without masking a
		// genuine hang — a truly stuck test still fails, just later. The DB setup runs in
		// beforeEach, so hookTimeout is the one that matters most.
		testTimeout: 20_000,
		hookTimeout: 30_000,
	},
});
