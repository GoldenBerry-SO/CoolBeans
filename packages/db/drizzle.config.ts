// ABOUTME: Drizzle Kit config — generates portable SQLite migrations from the schema barrel.
// ABOUTME: The server applies pending migrations on boot (self-host and k8s alike).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/index.ts',
	out: './drizzle',
});
