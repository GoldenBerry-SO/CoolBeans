// ABOUTME: Auth factory for the admin dashboard — Better Auth over the shared Database.
// ABOUTME: Public license endpoints never use this; there the key itself is the credential.

import type { Database } from '@coolbeans/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export interface AuthOptions {
	db: Database;
	secret: string;
	baseURL?: string;
}

export function createAuth({ db, secret, baseURL }: AuthOptions) {
	return betterAuth({
		database: drizzleAdapter(db, { provider: 'sqlite' }),
		secret,
		baseURL,
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;
