// ABOUTME: Auth factory smoke test — Better Auth accepts the shared migrated SQLite database.
// ABOUTME: Catches adapter or package upgrades that typecheck but fail during runtime construction.

import { createDb, migrate, openSqlite } from '@coolbeans/db';
import { describe, expect, it } from 'vitest';
import { createAuth } from './index.js';

describe('createAuth', () => {
	it('constructs a Better Auth handler over the shared database', () => {
		const db = createDb(openSqlite(':memory:'));
		migrate(db);
		const auth = createAuth({
			db,
			secret: 'test-auth-secret-0123456789abcdef',
			baseURL: 'http://localhost:3000',
		});
		expect(auth.handler).toBeTypeOf('function');
		expect(auth.api).toBeDefined();
	});
});
