// ABOUTME: Driver-independent database error classification regression tests.
// ABOUTME: Drizzle adapters may wrap constraint details in Error.cause.

import { describe, expect, it } from 'vitest';
import { isUniqueConstraintError } from './db-errors.js';

describe('isUniqueConstraintError', () => {
	it('recognizes a wrapped libSQL uniqueness violation', () => {
		const cause = Object.assign(new Error('UNIQUE constraint failed: licenses.key'), {
			code: 'SQLITE_CONSTRAINT_UNIQUE',
		});
		const error = new Error('Failed query', { cause });
		expect(isUniqueConstraintError(error, ['licenses.key'])).toBe(true);
	});

	it('recognizes Postgres 23505 without classifying unrelated failures', () => {
		const unique = Object.assign(new Error('duplicate key (provider_checkout_id)'), {
			code: '23505',
		});
		expect(isUniqueConstraintError(unique, ['provider_checkout_id'])).toBe(true);
		expect(isUniqueConstraintError(new Error('database unavailable'))).toBe(false);
	});
});
