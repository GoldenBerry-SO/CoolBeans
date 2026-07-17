// ABOUTME: Drizzle Kit config — generates portable SQLite migrations from the schema barrel.
// ABOUTME: Node applies them on boot; the cloud applies them via wrangler d1 migrations apply.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/index.ts',
	out: './drizzle',
});
