// ABOUTME: Node (self-host / k8s) entrypoint — loads config, opens the DB, migrates, and serves.
// ABOUTME: Reads configuration from process.env; see .env.example at the repo root.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDb, migrate, openSqlite } from '@coolbeans/db';
import { createLogger } from '@coolbeans/logger';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { mountConsole } from './console-static.js';
import type { AppDeps } from './deps.js';
import { authRateLimiter, publicRateLimiter } from './middleware/rate-limit.js';
import { createRedisStore } from './middleware/redis-store.js';
import { resolveEmailSender } from './services/email.js';
import { createPayPalGateway } from './services/paypal-gateway.js';
import { assertSigningKeysUsable } from './services/signing.js';
import { createStripeGateway } from './services/stripe-gateway.js';

const logger = createLogger();

let config: ReturnType<typeof loadConfig>;
try {
	config = loadConfig();
} catch (err) {
	logger.error('Configuration error', { message: (err as Error).message });
	process.exit(1);
}

if (config.databaseUrl.startsWith('postgres')) {
	// Guard: without this we'd silently create a SQLite file literally named "postgres://…".
	logger.error(
		'DATABASE_URL points at Postgres, which is not supported yet (see the Postgres issue). Use a SQLite file path.',
	);
	process.exit(1);
}
// Ensure the SQLite directory exists before opening the file.
if (config.databaseUrl !== ':memory:') mkdirSync(dirname(config.databaseUrl), { recursive: true });
const db = createDb(openSqlite(config.databaseUrl));
migrate(db);

// Fail fast if the configured secret cannot read the signing keys already stored:
// discovering that on the first token request looks like an outage, not a config error.
try {
	assertSigningKeysUsable({ db, config });
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
