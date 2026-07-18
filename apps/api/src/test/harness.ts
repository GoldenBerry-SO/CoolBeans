// ABOUTME: Test harness — builds AppDeps over an in-memory migrated DB with a controllable clock.
// ABOUTME: Used by handler and service tests; no HTTP server, no real email or payment providers.

import { createDb, migrate, openSqlite } from '@coolbeans/db';
import type { EmailSender, OutgoingEmail } from '@coolbeans/email';
import { createLogger } from '@coolbeans/logger';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppDeps } from '../deps.js';

export interface FakeClock {
	now(): Date;
	advance(ms: number): void;
	set(date: Date): void;
}

export function fakeClock(start = '2026-07-17T09:00:00.000Z'): FakeClock {
	let current = new Date(start).getTime();
	return {
		now: () => new Date(current),
		advance: (ms) => {
			current += ms;
		},
		set: (date) => {
			current = date.getTime();
		},
	};
}

export interface CapturingEmail extends EmailSender {
	sent: OutgoingEmail[];
	failNext: boolean;
}

export function capturingEmail(): CapturingEmail {
	const sent: OutgoingEmail[] = [];
	return {
		sent,
		failNext: false,
		async send(email) {
			if (this.failNext) {
				this.failNext = false;
				throw new Error('Simulated email failure');
			}
			sent.push(email);
		},
	};
}

export const TEST_ADMIN_TOKEN = 'test-admin-token-0123456789';

export function testConfig(overrides: Partial<Config> = {}): Config {
	return {
		databaseUrl: ':memory:',
		port: 0,
		adminToken: TEST_ADMIN_TOKEN,
		signingKeySecret: 'test-signing-secret-0123456789',
		tokenTtlDays: 7,
		publicUrl: 'http://localhost:3000',
		...overrides,
	};
}

/** A fake Stripe gateway: 'valid' signature passes, others throw; reads come from maps. */
export function fakeStripeGateway(
	periodEnds: Record<string, string> = {},
	sessionPrices: Record<string, string[]> = {},
	extras: {
		invoiceSubscriptions?: Record<string, string>;
		chargeSubscriptions?: Record<string, string>;
		sessions?: Record<string, Record<string, unknown>>;
		/** Stripe returns no secret when an endpoint already exists; set '' to model that. */
		connectSecret?: string;
	} = {},
) {
	return {
		constructEvent(rawBody: string, signature: string, _secret: string) {
			if (signature !== 'valid') throw new Error('Invalid signature');
			return JSON.parse(rawBody);
		},
		async subscriptionPeriodEnd(subscriptionId: string): Promise<string | null> {
			return periodEnds[subscriptionId] ?? null;
		},
		async sessionPriceIds(sessionId: string): Promise<string[]> {
			return sessionPrices[sessionId] ?? [];
		},
		async invoiceSubscription(invoiceId: string): Promise<string | null> {
			return extras.invoiceSubscriptions?.[invoiceId] ?? null;
		},
		async subscriptionForCharge(chargeId: string): Promise<string | null> {
			return extras.chargeSubscriptions?.[chargeId] ?? null;
		},
		async getCheckoutSession(sessionId: string): Promise<Record<string, unknown> | null> {
			return extras.sessions?.[sessionId] ?? null;
		},
		async billingPortalSession(customerId: string, returnUrl: string): Promise<string> {
			return `https://billing.stripe.test/${customerId}?return=${encodeURIComponent(returnUrl)}`;
		},
		async connect(args: { productSlug: string }) {
			return {
				lifetimePriceId: `price_lifetime_${args.productSlug}`,
				yearlyPriceId: `price_yearly_${args.productSlug}`,
				webhookSecret: extras.connectSecret ?? `whsec_${args.productSlug}`,
			};
		},
	};
}

/** A fake PayPal gateway: verify honors a flag; next-billing from a map. */
export function fakePayPalGateway(
	opts: {
		verified?: boolean;
		nextBilling?: Record<string, string>;
		orders?: Record<string, Record<string, unknown>>;
	} = {},
) {
	return {
		async getOrder(orderId: string): Promise<Record<string, unknown> | null> {
			return opts.orders?.[orderId] ?? null;
		},
		async verify(): Promise<boolean> {
			return opts.verified ?? true;
		},
		async subscriptionNextBilling(id: string): Promise<string | null> {
			return opts.nextBilling?.[id] ?? null;
		},
	};
}

export interface TestHarness {
	deps: AppDeps;
	app: ReturnType<typeof createApp>;
	clock: FakeClock;
	email: CapturingEmail;
	adminHeaders: Record<string, string>;
}

export function makeHarness(
	overrides: { config?: Partial<Config>; rateLimit?: AppDeps['rateLimit'] } = {},
): TestHarness {
	const db = createDb(openSqlite(':memory:'));
	migrate(db);
	const clock = fakeClock();
	const email = capturingEmail();
	const deps: AppDeps = {
		db,
		config: testConfig(overrides.config),
		logger: createLogger({ level: 'error' }),
		email,
		rateLimit: overrides.rateLimit,
		now: () => clock.now(),
	};
	return {
		deps,
		app: createApp(deps),
		clock,
		email,
		adminHeaders: {
			Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
			'Content-Type': 'application/json',
		},
	};
}
