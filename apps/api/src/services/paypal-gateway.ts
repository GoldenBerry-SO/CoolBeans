// ABOUTME: The PayPal gateway seam (PRD §13) — webhook signature verification + subscription reads.
// ABOUTME: A real REST-backed impl for production; tests inject a fake so no network is required.

export interface PayPalEvent {
	id: string;
	event_type: string;
	resource: Record<string, unknown>;
}

export interface PayPalVerifyInput {
	transmissionId: string;
	transmissionTime: string;
	transmissionSig: string;
	certUrl: string;
	authAlgo: string;
	webhookId: string;
	body: string;
}

export interface PayPalGateway {
	/** Verify a webhook via PayPal's verify-webhook-signature API. */
	verify(input: PayPalVerifyInput): Promise<boolean>;
	/** next_billing_time of a subscription as ISO 8601, for renewal expiry. */
	subscriptionNextBilling(subscriptionId: string): Promise<string | null>;
}

interface PayPalConfig {
	clientId: string;
	secret: string;
	baseUrl?: string;
}

async function accessToken(cfg: Required<PayPalConfig>): Promise<string> {
	const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	if (!res.ok) throw new Error(`PayPal oauth failed: ${res.status}`);
	const data = (await res.json()) as { access_token?: string };
	if (!data.access_token) throw new Error('PayPal oauth returned no access token');
	return data.access_token;
}

/** Production gateway backed by the PayPal REST API. */
export function createPayPalGateway(config: PayPalConfig): PayPalGateway {
	const cfg: Required<PayPalConfig> = {
		baseUrl: config.baseUrl ?? 'https://api-m.paypal.com',
		...config,
	};
	return {
		async verify(input) {
			const token = await accessToken(cfg);
			const res = await fetch(`${cfg.baseUrl}/v1/notifications/verify-webhook-signature`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					transmission_id: input.transmissionId,
					transmission_time: input.transmissionTime,
					cert_url: input.certUrl,
					auth_algo: input.authAlgo,
					transmission_sig: input.transmissionSig,
					webhook_id: input.webhookId,
					webhook_event: JSON.parse(input.body),
				}),
			});
			if (!res.ok) return false;
			const data = (await res.json()) as { verification_status?: string };
			return data.verification_status === 'SUCCESS';
		},
		async subscriptionNextBilling(subscriptionId) {
			const token = await accessToken(cfg);
			const res = await fetch(`${cfg.baseUrl}/v1/billing/subscriptions/${subscriptionId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { billing_info?: { next_billing_time?: string } };
			return data.billing_info?.next_billing_time ?? null;
		},
	};
}
