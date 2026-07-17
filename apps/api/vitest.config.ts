// ABOUTME: Vitest configuration for the API app — Node environment unit and handler tests.
// ABOUTME: Handler tests drive the app via app.request; DB integration tests use a throwaway SQLite file.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
	},
});
