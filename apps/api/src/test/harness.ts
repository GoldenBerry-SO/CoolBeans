// ABOUTME: Test harness — builds AppDeps over an in-memory migrated DB with a controllable clock.
// ABOUTME: Used by handler and service tests; no HTTP server, no real email or payment providers.

import { createDb, migrate, openSqlite } from '@coolbeans/db';
import type { EmailSender, OutgoingEmail } from '@coolbeans/email';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { AppDeps } from '../deps.js';
import type { BillingSubscription, CheckoutArgs } from '../services/billing-gateway.js';
import { resetKeyThrottle } from '../services/key-throttle.js';
import type { SessionLineItem } from '../services/stripe-gateway.js';

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
		logMagicCodes: false,
		...overrides,
	};
}

/** A fake Stripe gateway: 'valid' signature passes, others throw; reads come from maps. */
export function fakeStripeGateway(
	periodEnds: Record<string, string> = {},
	// A bare price id means quantity 1, which is what almost every test wants; pass the
	// object form only when the quantity is the point.
	sessionPrices: Record<string, Array<string | SessionLineItem>> = {},
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
		async sessionLineItems(sessionId: string): Promise<SessionLineItem[]> {
			return (sessionPrices[sessionId] ?? []).map((item) =>
				typeof item === 'string' ? { priceId: item, quantity: 1 } : item,
			);
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

/**
 * A fake platform-billing gateway. Separate from fakeStripeGateway on purpose, mirroring
 * the production split: a test that wires one into the other's slot should not compile.
 *
 * 'valid-billing' is the signature that passes here — deliberately NOT the product
 * webhook's 'valid', so a test cannot accidentally sign a payload for the wrong endpoint
 * and have it work.
 */
export function fakeBillingGateway(
	opts: { subscriptions?: Record<string, BillingSubscription>; nextCustomerId?: string } = {},
) {
	const created: Array<{ email: string; accountId: number }> = [];
	const checkouts: CheckoutArgs[] = [];
	return {
		created,
		checkouts,
		async createCustomer(args: { email: string; accountId: number; name?: string }) {
			created.push({ email: args.email, accountId: args.accountId });
			return opts.nextCustomerId ?? `cus_${args.accountId}`;
		},
		async createCheckoutSession(args: CheckoutArgs) {
			checkouts.push(args);
			return `https://checkout.stripe.test/${args.customerId}`;
		},
		async billingPortalSession(customerId: string, returnUrl: string) {
			return `https://portal.stripe.test/${customerId}?return=${encodeURIComponent(returnUrl)}`;
		},
		constructEvent(rawBody: string, signature: string, _secret: string) {
			if (signature !== 'valid-billing') throw new Error('Invalid signature');
			return JSON.parse(rawBody);
		},
		async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
			return opts.subscriptions?.[subscriptionId] ?? null;
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
	logger: ReturnType<typeof capturingLogger>;
	adminHeaders: Record<string, string>;
}

export interface CapturedLine {
	level: string;
	message: string;
	fields?: Record<string, unknown>;
}

/** A logger that records everything, so a test can assert a secret was NOT logged. */
export function capturingLogger() {
	const lines: CapturedLine[] = [];
	const at = (level: string) => (message: string, fields?: Record<string, unknown>) => {
		lines.push({ level, message, fields });
	};
	const logger = {
		lines,
		debug: at('debug'),
		info: at('info'),
		warn: at('warn'),
		error: at('error'),
		child() {
			return logger;
		},
	};
	return logger;
}

export function makeHarness(
	overrides: {
		config?: Partial<Config>;
		rateLimit?: AppDeps['rateLimit'];
		authRateLimit?: AppDeps['authRateLimit'];
	} = {},
): TestHarness {
	// Throttle state is module-level, so each harness starts from a clean slate.
	resetKeyThrottle();
	const db = createDb(openSqlite(':memory:'));
	migrate(db);
	const clock = fakeClock();
	const email = capturingEmail();
	const logger = capturingLogger();
	const deps: AppDeps = {
		db,
		config: testConfig(overrides.config),
		logger,
		email,
		rateLimit: overrides.rateLimit,
		authRateLimit: overrides.authRateLimit,
		now: () => clock.now(),
	};
	return {
		deps,
		app: createApp(deps),
		clock,
		email,
		logger,
		adminHeaders: {
			Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
			'Content-Type': 'application/json',
		},
	};
}
