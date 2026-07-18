// ABOUTME: The dependency bundle injected into the app and route factories.
// ABOUTME: One shape so Node boot, tests, and the worker all construct the same wiring.

import type { Database } from '@coolbeans/db';
import type { EmailSender } from '@coolbeans/email';
import type { Logger } from '@coolbeans/logger';
import type { Config } from './config.js';
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
	/** Absent when PayPal is not configured. */
	paypal?: PayPalGateway;
	/** Injectable clock for deterministic tests. Returns an ISO 8601 string. */
	now?: () => Date;
}

/** Current time as a Date, honoring an injected clock. */
export function nowDate(deps: Pick<AppDeps, 'now'>): Date {
	return deps.now ? deps.now() : new Date();
}

/** Current time as an ISO 8601 string. */
export function nowIso(deps: Pick<AppDeps, 'now'>): string {
	return nowDate(deps).toISOString();
}
