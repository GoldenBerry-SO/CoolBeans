// ABOUTME: Environment config parsing and validation (PRD §18) — fail fast on insecure defaults.
// ABOUTME: Pure over an env record so tests construct config without touching process.env.

export interface Config {
	databaseUrl: string;
	port: number;
	adminToken: string;
	/** Hex secret that encrypts signing private keys at rest. */
	signingKeySecret: string;
	tokenTtlDays: number;
	stripe?: {
		secretKey: string;
		webhookSecret?: string;
		/**
		 * Point the Stripe SDK somewhere other than api.stripe.com. Only for local
		 * journey tests against a mock — unset in production, where it must be the
		 * real Stripe.
		 */
		apiBase?: string;
	};
	paypal?: { clientId: string; secret: string; webhookId: string };
	email?:
		| {
				provider: 'resend';
				apiKey: string;
				/**
				 * Point the Resend client somewhere other than api.resend.com. Only for
				 * local journey tests against a mock — unset in production.
				 */
				baseUrl?: string;
		  }
		| { provider: 'smtp'; host: string; port: number; user?: string; pass?: string }
		| {
				/** Development only: log emails instead of delivering them. */
				provider: 'console';
		  };
	redisUrl?: string;
	/** Where the console/portal are served from, for building portal/billing links. */
	publicUrl: string;
	/**
	 * Print sign-in codes to the log. Local development only — a code is a credential,
	 * and §19 says those are never logged. loadConfig refuses to start with this on
	 * outside development so it cannot be switched on by a copied .env.
	 */
	logMagicCodes: boolean;
}

export class ConfigError extends Error {}

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value) throw new ConfigError(`Missing required env var: ${name}`);
	return value;
}

/** Build and validate config from an env record. Throws ConfigError on bad/missing values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const adminToken = requireVar(env, 'ADMIN_TOKEN');
	if (adminToken.length < 16) {
		throw new ConfigError('ADMIN_TOKEN must be at least 16 characters');
	}
	const signingKeySecret = requireVar(env, 'SIGNING_KEY_SECRET');
	if (signingKeySecret.length < 16) {
		throw new ConfigError('SIGNING_KEY_SECRET must be at least 16 characters');
	}

	const port = Number(env.PORT ?? 3000);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new ConfigError(`PORT must be a valid port number, got "${env.PORT}"`);
	}
	const tokenTtlDays = Number(env.OFFLINE_TOKEN_TTL_DAYS ?? 7);
	if (!Number.isFinite(tokenTtlDays) || tokenTtlDays <= 0) {
		throw new ConfigError(
			`OFFLINE_TOKEN_TTL_DAYS must be a positive number, got "${env.OFFLINE_TOKEN_TTL_DAYS}"`,
		);
	}

	const logMagicCodes = env.LOG_MAGIC_CODES === 'true';
	if (logMagicCodes && env.NODE_ENV === 'production') {
		throw new ConfigError(
			'LOG_MAGIC_CODES cannot be enabled with NODE_ENV=production: a sign-in code is a credential and must never reach the logs outside local development.',
		);
	}

	const config: Config = {
		logMagicCodes,
		databaseUrl: env.DATABASE_URL ?? './data/coolbeans.sqlite',
		port,
		adminToken,
		signingKeySecret,
		tokenTtlDays,
		publicUrl: env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`,
		redisUrl: env.REDIS_URL,
	};

	if (env.STRIPE_SECRET_KEY) {
		config.stripe = {
			secretKey: env.STRIPE_SECRET_KEY,
			webhookSecret: env.STRIPE_WEBHOOK_SECRET,
			...(env.STRIPE_API_BASE ? { apiBase: env.STRIPE_API_BASE } : {}),
		};
	}
	if (env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET && env.PAYPAL_WEBHOOK_ID) {
		config.paypal = {
			clientId: env.PAYPAL_CLIENT_ID,
			secret: env.PAYPAL_SECRET,
			webhookId: env.PAYPAL_WEBHOOK_ID,
		};
	}
	if (env.EMAIL_PROVIDER === 'console') {
		// Never in production: an instance that quietly logs key emails instead of
		// sending them looks healthy while every buyer waits for a key that never comes.
		if (env.NODE_ENV === 'production') {
			throw new ConfigError(
				'EMAIL_PROVIDER=console only exists for local development: it logs emails instead of delivering them. Use resend or smtp in production.',
			);
		}
		config.email = { provider: 'console' };
	} else if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
		config.email = {
			provider: 'resend',
			apiKey: env.RESEND_API_KEY,
			...(env.RESEND_BASE_URL ? { baseUrl: env.RESEND_BASE_URL } : {}),
		};
	} else if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
		config.email = {
			provider: 'smtp',
			host: env.SMTP_HOST,
			port: Number(env.SMTP_PORT ?? 587),
			user: env.SMTP_USER,
			pass: env.SMTP_PASS,
		};
	}

	// An instance with no sender still issues keys and still answers 200 to Stripe. It
	// looks healthy while every buyer waits for an email that was never sent, and key
	// recovery cannot rescue them either, because that needs a sender too.
	if (!config.email && env.NODE_ENV === 'production') {
		throw new ConfigError(
			'No EMAIL_PROVIDER configured: this instance would issue license keys and never deliver them. Set EMAIL_PROVIDER to resend or smtp.',
		);
	}

	return config;
}
