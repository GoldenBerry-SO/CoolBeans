// ABOUTME: A tiny stand-in for the Stripe REST endpoints our gateway calls, for journey tests.
// ABOUTME: Returns data WE choose, so price-id resolution and renewal dates are assertable.

import { createServer } from 'node:http';

/**
 * stripe-mock (the official one) serves canned fixtures, so a session's line items would
 * never carry the price id our product is configured with — exactly the thing worth
 * asserting. This returns what the journey sets up instead.
 */
const state = {
	sessions: new Map(),
	subscriptions: new Map(),
	invoices: new Map(),
	charges: new Map(),
	// Seed { recurring: { interval: 'month' } } to state a price's cadence outright; without
	// a seed the id names it (…month…, …year…), which keeps most tests to one line.
	prices: new Map(),
};

// connect stores this on the connection; the journey signs its webhooks with the same value,
// so deliveries keep verifying after onboarding. Matches run.mjs's default.
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_journey';

function json(res, body, status = 200) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(payload);
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const path = url.pathname;

	// Journey control plane: the test seeds what Stripe "knows" before firing a webhook.
	if (req.method === 'POST' && path === '/__seed') {
		let body = '';
		req.on('data', (c) => {
			body += c;
		});
		req.on('end', () => {
			const seed = JSON.parse(body);
			for (const [kind, entries] of Object.entries(seed)) {
				for (const [id, value] of Object.entries(entries)) {
					state[kind]?.set(id, value);
				}
			}
			json(res, { seeded: true });
		});
		return;
	}

	// Connect onboarding: register the webhook endpoint and hand back a signing secret.
	if (path === '/v1/webhook_endpoints') {
		if (req.method === 'GET') {
			// Idempotency probe: no existing endpoint, so connect creates one.
			return json(res, { object: 'list', data: [], has_more: false });
		}
		if (req.method === 'POST') {
			req.on('data', () => {});
			req.on('end', () => {
				json(res, {
					id: 'we_journey',
					object: 'webhook_endpoint',
					status: 'enabled',
					secret: WEBHOOK_SECRET,
				});
			});
			return;
		}
	}

	// GET /v1/prices/:id — a grant confirms the price exists and its billing mode before it
	// is mapped. The cadence comes from the id so a test can ask for any of them: pricing is
	// the vendor's, and a monthly price is as valid as an annual one.
	let m = path.match(/^\/v1\/prices\/([^/]+)$/);
	if (m && req.method === 'GET') {
		const seeded = state.prices.get(m[1]);
		if (seeded) return json(res, { id: m[1], object: 'price', active: true, ...seeded });
		const id = m[1].toLowerCase();
		const interval = ['day', 'week', 'month', 'year'].find((unit) => id.includes(unit));
		return json(res, {
			id: m[1],
			object: 'price',
			active: true,
			recurring: interval ? { interval } : null,
		});
	}

	// GET /v1/checkout/sessions/:id/line_items — drives product+kind resolution (§13).
	m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/);
	if (m) {
		const session = state.sessions.get(m[1]);
		const priceId = session?.price_id;
		return json(res, {
			object: 'list',
			data: priceId ? [{ id: 'li_1', price: { id: priceId } }] : [],
		});
	}

	// GET /v1/checkout/sessions/:id — the success-page ensure path (§14).
	m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
	if (m) {
		const session = state.sessions.get(m[1]);
		if (!session) return json(res, { error: { message: 'No such session' } }, 404);
		return json(res, session.object ?? session);
	}

	// GET /v1/subscriptions/:id — Basil keeps current_period_end on the item.
	m = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
	if (m) {
		const sub = state.subscriptions.get(m[1]);
		if (!sub) return json(res, { error: { message: 'No such subscription' } }, 404);
		return json(res, {
			id: m[1],
			object: 'subscription',
			items: { object: 'list', data: [{ current_period_end: sub.current_period_end }] },
		});
	}

	// GET /v1/invoices/:id — refunded renewals resolve through here (§13 notes).
	m = path.match(/^\/v1\/invoices\/([^/]+)$/);
	if (m) {
		const invoice = state.invoices.get(m[1]);
		if (!invoice) return json(res, { error: { message: 'No such invoice' } }, 404);
		return json(res, { id: m[1], object: 'invoice', ...invoice });
	}

	// GET /v1/charges/:id — dispute/refund resolution.
	m = path.match(/^\/v1\/charges\/([^/]+)$/);
	if (m) {
		const charge = state.charges.get(m[1]);
		if (!charge) return json(res, { error: { message: 'No such charge' } }, 404);
		return json(res, { id: m[1], object: 'charge', ...charge });
	}

	json(res, { error: { message: `stripe-mock: unhandled ${req.method} ${path}` } }, 404);
});

const port = Number(process.env.PORT ?? 12111);
server.listen(port, () => {
	console.log(`stripe mock listening on ${port}`);
});
