// ABOUTME: Auth factory smoke test — Better Auth accepts the shared migrated database.
// ABOUTME: Catches adapter or package upgrades that typecheck but fail during runtime construction.

import { MIGRATIONS_FOLDER, schema } from '@coolbeans/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { createAuth } from './index.js';

describe('createAuth', () => {
	// 30s, not vitest's 5s default: the test boots PGlite (WASM), migrates 18 tables and
	// constructs Better Auth. ~2s warm locally, but on a cold shared CI runner it has
	// repeatedly crossed 5s — flaking three times locally under parallel load and then
	// failing the first gated deploy. The budget is the fix; the assertions are unchanged.
	it('constructs a Better Auth handler over the shared database', { timeout: 30_000 }, async () => {
		// PGlite for the same reason the API suite uses it: real Postgres without a server.
		const db = drizzle(new PGlite(), { schema });
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		const auth = createAuth({
			db,
			secret: 'test-auth-secret-0123456789abcdef',
			baseURL: 'http://localhost:3000',
		});
		expect(auth.handler).toBeTypeOf('function');
		expect(auth.api).toBeDefined();
	});
});
