// ABOUTME: Drizzle Kit config — generates PostgreSQL migrations from the schema barrel.
// ABOUTME: Migrations are applied by the migrate CLI, never at server boot (see migrate-cli.ts).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema/index.ts',
	out: './drizzle',
});
