// ABOUTME: Produces genuinely signature-valid Stripe webhook deliveries, no Stripe CLI needed.
// ABOUTME: Same HMAC scheme Stripe uses, so the server's real constructEvent verifies it.

import { createHmac } from 'node:crypto';

/**
 * Stripe signs `${timestamp}.${payload}` with the endpoint secret and sends it as
 * `t=<ts>,v1=<hex>`. Building it here means the journey exercises the REAL verification
 * path — a test that bypassed signatures would not catch a broken secret, which is
 * exactly the failure mode connect had.
 */
export function stripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
	const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
	return `t=${timestamp},v1=${signature}`;
}

export async function sendStripeWebhook(baseUrl, secret, event, { path } = {}) {
	const payload = JSON.stringify(event);
	const res = await fetch(`${baseUrl}${path ?? '/v1/stripe/webhook'}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'stripe-signature': stripeSignature(payload, secret),
		},
		body: payload,
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	return { status: res.status, body };
}
