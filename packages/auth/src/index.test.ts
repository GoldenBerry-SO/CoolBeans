// ABOUTME: Auth factory smoke test — Better Auth accepts the shared migrated database.
// ABOUTME: Catches adapter or package upgrades that typecheck but fail during runtime construction.

import { MIGRATIONS_FOLDER, schema } from '@coolbeans/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { createAuth } from './index.js';

describe('createAuth', () => {
	it('constructs a Better Auth handler over the shared database', async () => {
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
