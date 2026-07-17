// ABOUTME: Vitest configuration for the API app — plain Node environment unit/handler tests.
// ABOUTME: D1-backed integration tests will use @cloudflare/vitest-pool-workers in a second config.

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
	},
});
