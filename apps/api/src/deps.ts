// ABOUTME: The dependency bundle injected into the app and route factories.
// ABOUTME: One shape so Node boot, tests, and the worker all construct the same wiring.

import type { Database } from '@coolbeans/db';
import type { EmailSender } from '@coolbeans/email';
import type { Logger } from '@coolbeans/logger';
import type { MiddlewareHandler } from 'hono';
import type { Config } from './config.js';
import type { BillingGateway } from './services/billing-gateway.js';
import type { PayPalGateway } from './services/paypal-gateway.js';
import type { StripeGateway } from './services/stripe-gateway.js';

export interface AppDeps {
	db: Database;
	config: Config;
	logger: Logger;
	/** Absent when no email provider is configured; issuance still works, email is skipped. */
	email?: EmailSender;
	/** Absent when Stripe is not configured; the webhook route is inert without it. */
	stripe?: StripeGateway;
	/**
	 * Platform billing — customers paying us for hosted Cool Beans. Separate from `stripe`
	 * above, which is a customer's own integration for selling their software.
	 */
	billing?: BillingGateway;
	/** Absent when PayPal is not configured. */
	paypal?: PayPalGateway;
	/** Optional rate-limit middleware applied to /v1/* (webhooks excluded). */
	rateLimit?: MiddlewareHandler;
	/** Separate limiter for magic-code request and verification endpoints. */
	authRateLimit?: MiddlewareHandler;
	/** Injectable clock for deterministic tests. Returns an ISO 8601 string. */
	now?: () => Date;
}

/**
 * The same dependency bundle, bound to a transaction handle.
 *
 * Every helper that writes takes `deps` and reaches the database as `deps.db`, so the only
 * way to run a helper inside a transaction is to hand it a deps whose `db` IS the
 * transaction. Threading a bare `tx` through twenty signatures was the alternative, and it
 * is exactly how the leak happened: a body that takes `tx` but calls `helper(deps, ...)`
 * compiles fine and writes outside the transaction.
 *
 * The failure modes of getting this wrong are not theoretical. On postgres-js a helper's
 * write lands on another pool connection outside the transaction, so a rollback leaves an
 * orphaned `purchases` row whose `provider_checkout_id` UNIQUE then blocks every provider
 * retry — the customer paid and no retry can ever succeed. On the single-connection test
 * driver the same call deadlocks against the transaction's own mutex. Either way: bind
 * the bundle, never mix handles.
 */
export function withTx(deps: AppDeps, tx: AppDeps['db']): AppDeps {
	return { ...deps, db: tx };
}

/** Current time as a Date, honoring an injected clock. */
export function nowDate(deps: Pick<AppDeps, 'now'>): Date {
	return deps.now ? deps.now() : new Date();
}

/** Current time as an ISO 8601 string. */
export function nowIso(deps: Pick<AppDeps, 'now'>): string {
	return nowDate(deps).toISOString();
}
