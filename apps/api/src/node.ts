// ABOUTME: Node (self-host / k8s) entrypoint — loads config, checks the schema, and serves.
// ABOUTME: Reads configuration from process.env; see .env.example at the repo root.

import { assertSchemaCurrent, createDb, createPool, migrate } from '@coolbeans/db';
import { createLogger } from '@coolbeans/logger';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { mountConsole } from './console-static.js';
import type { AppDeps } from './deps.js';
import { authRateLimiter, publicRateLimiter } from './middleware/rate-limit.js';
import { createRedisStore } from './middleware/redis-store.js';
import { createBillingGateway } from './services/billing-gateway.js';
import { resolveEmailSender } from './services/email.js';
import { createPayPalGateway } from './services/paypal-gateway.js';
import { assertSigningKeysUsable } from './services/signing.js';
import { createStripeGateway } from './services/stripe-gateway.js';
import { assertAccountsResolve } from './store/accounts.js';

const logger = createLogger();

let config: ReturnType<typeof loadConfig>;
try {
	config = loadConfig();
} catch (err) {
	logger.error('Configuration error', { message: (err as Error).message });
	process.exit(1);
}

if (!config.databaseUrl.startsWith('postgres')) {
	// The guard used to point the other way, refusing postgres URLs while the adapter was
	// SQLite. Inverted rather than removed: a leftover SQLite path from an old .env would
	// otherwise surface as an opaque driver error instead of an instruction.
	logger.error(
		'DATABASE_URL must be a postgres:// URL. Cool Beans runs on PostgreSQL; docker compose provides one for self-hosting (see README).',
	);
	process.exit(1);
}
const db = createDb(createPool(config.databaseUrl));

// Migrations do NOT run at boot. With replicas, a worker and the migration Job all
// starting inside one deploy, boot-time DDL is a race with a half-applied schema as its
// failure mode. The Job (db:migrate) is the single migrator; a single-process self-host
// can opt back into the old behaviour explicitly.
if (process.env.MIGRATE_ON_BOOT === 'true') {
	await migrate(db);
} else {
	try {
		await assertSchemaCurrent(db);
	} catch (err) {
		logger.error('Schema check failed', { message: (err as Error).message });
		process.exit(1);
	}
}

// products.account_id and admin_users.account_id carry no foreign key (SQLite would not
// take one on an added NOT NULL column), so this is the constraint. A backfill that went
// wrong should stop the process, not serve one tenant another's data.
try {
	await assertAccountsResolve(db);
} catch (err) {
	logger.error('Account integrity check failed', { message: (err as Error).message });
	process.exit(1);
}

// Fail fast if the configured secret cannot read the signing keys already stored:
// discovering that on the first token request looks like an outage, not a config error.
try {
	await assertSigningKeysUsable({ db, config });
} catch (err) {
	logger.error('Signing key validation failed', { message: (err as Error).message });
	process.exit(1);
}

// Redis-backed rate limiting holds across replicas; in-memory otherwise (single-instance/dev).
const redis = config.redisUrl ? new Redis(config.redisUrl) : undefined;
const rateLimitStore = redis ? createRedisStore(redis, 60_000) : undefined;
const rateLimit = publicRateLimiter({
	config,
	logger,
	store: rateLimitStore,
});
const authRateLimit = authRateLimiter({
	config,
	logger,
	store: rateLimitStore,
});

const deps: AppDeps = {
	db,
	config,
	logger,
	email: resolveEmailSender(config, logger),
	stripe: config.stripe
		? createStripeGateway(config.stripe.secretKey, config.stripe.apiBase)
		: undefined,
	billing: config.billing
		? createBillingGateway(config.billing.stripeSecretKey, config.billing.apiBase)
		: undefined,
	paypal: config.paypal
		? createPayPalGateway({ clientId: config.paypal.clientId, secret: config.paypal.secret })
		: undefined,
	rateLimit,
	authRateLimit,
};

const app = createApp(deps);

// Serve the built console SPA if present (production image / after `pnpm build`).
const webRoot = process.env.WEB_ROOT ?? 'apps/web/dist';
mountConsole(app, deps, webRoot);

serve({ fetch: app.fetch, port: config.port }, (info) => {
	logger.info('Cool Beans listening', { port: info.port });
});
