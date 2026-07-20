// ABOUTME: Config tests — the seams and refusals that keep local convenience out of production.
// ABOUTME: STRIPE_API_BASE exists so journey tests can point the gateway at a local mock.

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
	ADMIN_TOKEN: 'a'.repeat(20),
	SIGNING_KEY_SECRET: 'b'.repeat(20),
} as NodeJS.ProcessEnv;

describe('core configuration boundaries', () => {
	it.each(['ADMIN_TOKEN', 'SIGNING_KEY_SECRET'] as const)(
		'requires %s and refuses short credentials',
		(name) => {
			const missing = { ...base };
			delete missing[name];
			expect(() => loadConfig(missing)).toThrow(name);
			expect(() => loadConfig({ ...base, [name]: 'too-short' })).toThrow(/16 characters/);
		},
	);

	it.each(['-1', '1.5', '65536', 'not-a-number'])('rejects invalid PORT=%s', (PORT) => {
		expect(() => loadConfig({ ...base, PORT })).toThrow(/PORT/);
	});

	it.each(['0', '-1', 'Infinity', 'not-a-number'])(
		'rejects invalid OFFLINE_TOKEN_TTL_DAYS=%s',
		(OFFLINE_TOKEN_TTL_DAYS) => {
			expect(() => loadConfig({ ...base, OFFLINE_TOKEN_TTL_DAYS })).toThrow(
				/OFFLINE_TOKEN_TTL_DAYS/,
			);
		},
	);

	it('accepts the supported server-port boundaries', () => {
		expect(loadConfig({ ...base, PORT: '0' }).port).toBe(0);
		expect(loadConfig({ ...base, PORT: '65535' }).port).toBe(65_535);
	});
});

describe('SMTP configuration boundaries', () => {
	it('uses port 587 by default and accepts a valid override', () => {
		expect(
			loadConfig({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test' }).email,
		).toMatchObject({ provider: 'smtp', port: 587 });
		expect(
			loadConfig({
				...base,
				EMAIL_PROVIDER: 'smtp',
				SMTP_HOST: 'smtp.test',
				SMTP_PORT: '465',
			}).email,
		).toMatchObject({ provider: 'smtp', port: 465 });
	});

	it.each(['0', '-1', '1.5', '65536', 'not-a-number'])(
		'rejects invalid SMTP_PORT=%s',
		(SMTP_PORT) => {
			expect(() =>
				loadConfig({ ...base, EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test', SMTP_PORT }),
			).toThrow(/SMTP_PORT/);
		},
	);
});

describe('STRIPE_API_BASE (journey tests, stripe-mock)', () => {
	it('is carried into config so the gateway can be pointed at a local mock', () => {
		const config = loadConfig({
			...base,
			STRIPE_SECRET_KEY: 'sk_test_123',
			STRIPE_API_BASE: 'http://localhost:12111',
		} as NodeJS.ProcessEnv);
		expect(config.stripe?.apiBase).toBe('http://localhost:12111');
	});

	it('is absent by default, so production always talks to the real Stripe', () => {
		const config = loadConfig({
			...base,
			STRIPE_SECRET_KEY: 'sk_test_123',
		} as NodeJS.ProcessEnv);
		expect(config.stripe?.apiBase).toBeUndefined();
	});
});

describe('RESEND_BASE_URL (journey tests, mirrors STRIPE_API_BASE)', () => {
	it('is carried into config so the Resend client can be pointed at a local mock', () => {
		const config = loadConfig({
			...base,
			EMAIL_PROVIDER: 'resend',
			RESEND_API_KEY: 're_test_123',
			RESEND_BASE_URL: 'http://localhost:12112',
		} as NodeJS.ProcessEnv);
		assertResend(config);
		expect(config.email.baseUrl).toBe('http://localhost:12112');
	});

	it('is absent by default, so production always talks to the real Resend', () => {
		const config = loadConfig({
			...base,
			EMAIL_PROVIDER: 'resend',
			RESEND_API_KEY: 're_test_123',
		} as NodeJS.ProcessEnv);
		assertResend(config);
		expect(config.email.baseUrl).toBeUndefined();
	});
});

function assertResend(config: ReturnType<typeof loadConfig>): asserts config is ReturnType<
	typeof loadConfig
> & {
	email: { provider: 'resend'; apiKey: string; baseUrl?: string };
} {
	expect(config.email?.provider).toBe('resend');
}

describe('EMAIL_PROVIDER=console (development)', () => {
	it('is accepted for local development', () => {
		const config = loadConfig({ ...base, EMAIL_PROVIDER: 'console' } as NodeJS.ProcessEnv);
		expect(config.email?.provider).toBe('console');
	});

	it('refuses to start in production, where silently not sending email is a disaster', () => {
		expect(() =>
			loadConfig({
				...base,
				EMAIL_PROVIDER: 'console',
				NODE_ENV: 'production',
			} as NodeJS.ProcessEnv),
		).toThrow(/console/i);
	});
});

describe('no email sender at all', () => {
	it('is fine in development, where most work does not involve email', () => {
		const config = loadConfig(base);
		expect(config.email).toBeUndefined();
	});

	it('refuses to start in production: issuing keys nobody receives looks healthy', () => {
		// Without a sender the buyer gets no key email AND recovery cannot help them,
		// so the instance takes money and delivers nothing while reporting success.
		expect(() => loadConfig({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
			/EMAIL_PROVIDER/,
		);
	});

	it('starts in production once a real sender is configured', () => {
		const config = loadConfig({
			...base,
			NODE_ENV: 'production',
			EMAIL_PROVIDER: 'resend',
			RESEND_API_KEY: 're_live_123',
		} as NodeJS.ProcessEnv);
		expect(config.email?.provider).toBe('resend');
	});
});

describe('offline token buffer', () => {
	it('defaults to 14 days', () => {
		expect(loadConfig(base).offlineTokenBufferDays).toBe(14);
	});

	it('accepts an explicit value, including zero for no buffer at all', () => {
		expect(loadConfig({ ...base, OFFLINE_TOKEN_BUFFER_DAYS: '30' }).offlineTokenBufferDays).toBe(
			30,
		);
		expect(loadConfig({ ...base, OFFLINE_TOKEN_BUFFER_DAYS: '0' }).offlineTokenBufferDays).toBe(0);
	});

	it.each(['-1', 'not-a-number', 'Infinity'])(
		'rejects OFFLINE_TOKEN_BUFFER_DAYS=%s',
		(OFFLINE_TOKEN_BUFFER_DAYS) => {
			expect(() => loadConfig({ ...base, OFFLINE_TOKEN_BUFFER_DAYS })).toThrow(
				/OFFLINE_TOKEN_BUFFER_DAYS/,
			);
		},
	);
});

describe('platform billing configuration', () => {
	const billing = {
		...base,
		BILLING_STRIPE_SECRET_KEY: 'sk_billing_123',
		BILLING_STRIPE_PRO_PRICE_ID: 'price_pro_123',
	} as NodeJS.ProcessEnv;

	it('is absent unless a billing key is set, which is what makes self-host unlimited', () => {
		expect(loadConfig(base).billing).toBeUndefined();
	});

	it('does not turn on just because the product-sales integration is configured', () => {
		// A self-hoster selling their own software sets STRIPE_SECRET_KEY. That must never
		// put them on the hosted billing path or behind the hosted plan limits.
		const config = loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_customer' });
		expect(config.stripe).toBeDefined();
		expect(config.billing).toBeUndefined();
	});

	it('parses the BILLING_ namespace', () => {
		const config = loadConfig({
			...billing,
			BILLING_STRIPE_WEBHOOK_SECRET: 'whsec_billing',
			BILLING_STRIPE_API_BASE: 'http://localhost:4242',
		} as NodeJS.ProcessEnv);
		expect(config.billing).toEqual({
			stripeSecretKey: 'sk_billing_123',
			stripeWebhookSecret: 'whsec_billing',
			proPriceId: 'price_pro_123',
			apiBase: 'http://localhost:4242',
		});
	});

	it('refuses a billing key with no price id, in every environment', () => {
		// The console would show an Upgrade button that 500s on click, and every account
		// would sit on Free with no way off it.
		const noPrice = { ...billing };
		delete noPrice.BILLING_STRIPE_PRO_PRICE_ID;
		expect(() => loadConfig(noPrice)).toThrow(/BILLING_STRIPE_PRO_PRICE_ID/);
	});

	it('refuses a billing key with no webhook secret in production', () => {
		// Checkout succeeds, Stripe charges the card, the webhook is rejected, and the
		// customer stays on Free having paid us.
		expect(() => loadConfig({ ...billing, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
			/BILLING_STRIPE_WEBHOOK_SECRET/,
		);
	});

	it('allows a missing webhook secret outside production so the route can run inert', () => {
		expect(loadConfig(billing).billing?.stripeWebhookSecret).toBeUndefined();
	});

	it('refuses to share one Stripe key with the product-sales integration in production', () => {
		// One account means both flows arrive on one event stream, leaving the price-id
		// filter as the only thing stopping a Cool Beans Pro purchase from issuing
		// somebody a licence key.
		expect(() =>
			loadConfig({
				...billing,
				BILLING_STRIPE_WEBHOOK_SECRET: 'whsec_billing',
				STRIPE_SECRET_KEY: 'sk_billing_123',
				NODE_ENV: 'production',
				EMAIL_PROVIDER: 'resend',
				RESEND_API_KEY: 're_live_123',
			} as NodeJS.ProcessEnv),
		).toThrow(/same Stripe key/);
	});

	it('makes ADMIN_TOKEN optional once billing is on, because cloud has no god-mode', () => {
		const noToken = { ...billing };
		delete noToken.ADMIN_TOKEN;
		expect(loadConfig(noToken).adminToken).toBeUndefined();
	});

	it('still requires ADMIN_TOKEN for a self-host instance', () => {
		const noToken = { ...base };
		delete noToken.ADMIN_TOKEN;
		expect(() => loadConfig(noToken)).toThrow(/ADMIN_TOKEN/);
	});

	it('still enforces the length floor on an ADMIN_TOKEN that is supplied', () => {
		expect(() => loadConfig({ ...billing, ADMIN_TOKEN: 'short' })).toThrow(/16 characters/);
	});
});
