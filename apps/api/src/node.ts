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
import { publicRateLimiter } from './middleware/rate-limit.js';
import { createRedisStore } from './middleware/redis-store.js';
import { resolveEmailSender } from './services/email.js';
import { createPayPalGateway } from './services/paypal-gateway.js';
import { createStripeGateway } from './services/stripe-gateway.js';

const logger = createLogger();

let config: ReturnType<typeof loadConfig>;
try {
	config = loadConfig();
} catch (err) {
	logger.error('Configuration error', { message: (err as Error).message });
	process.exit(1);
}

if (!config.databaseUrl.startsWith('postgres')) {
	// Ensure the SQLite directory exists before opening the file.
	if (config.databaseUrl !== ':memory:')
		mkdirSync(dirname(config.databaseUrl), { recursive: true });
}
const db = createDb(openSqlite(config.databaseUrl));
migrate(db);

// Redis-backed rate limiting holds across replicas; in-memory otherwise (single-instance/dev).
const redis = config.redisUrl ? new Redis(config.redisUrl) : undefined;
const rateLimit = publicRateLimiter({
	config,
	logger,
	store: redis ? createRedisStore(redis, 60_000) : undefined,
});

const deps: AppDeps = {
	db,
	config,
	logger,
	email: resolveEmailSender(config, logger),
	stripe: config.stripe ? createStripeGateway(config.stripe.secretKey) : undefined,
	paypal: config.paypal
		? createPayPalGateway({ clientId: config.paypal.clientId, secret: config.paypal.secret })
		: undefined,
	rateLimit,
};

const app = createApp(deps);

// Serve the built console SPA if present (production image / after `pnpm build`).
const webRoot = process.env.WEB_ROOT ?? 'apps/web/dist';
mountConsole(app, deps, webRoot);

serve({ fetch: app.fetch, port: config.port }, (info) => {
	logger.info('Cool Beans listening', { port: info.port });
});
