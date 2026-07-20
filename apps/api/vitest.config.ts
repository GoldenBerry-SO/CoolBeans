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
	},
});
