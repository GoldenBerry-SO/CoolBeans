// ABOUTME: Config tests — the seams and refusals that keep local convenience out of production.
// ABOUTME: STRIPE_API_BASE exists so journey tests can point the gateway at a local mock.

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
	ADMIN_TOKEN: 'a'.repeat(20),
	SIGNING_KEY_SECRET: 'b'.repeat(20),
} as NodeJS.ProcessEnv;

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
