// ABOUTME: Public client API routes (PRD §9) — the frozen activate/validate/deactivate/heartbeat contract.
// ABOUTME: Every body carries `ok`; the key is the credential, no service secret required.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest, notFound, unauthorized } from '../../http/errors.js';
import { serializeInstance, serializeLicense } from '../../http/serializers.js';
import { isAdminRequest } from '../../middleware/admin-auth.js';
import { activate, deactivate, heartbeat, validate } from '../../services/licensing.js';
import { findByCheckoutId } from '../../services/payments.js';
import { ensureLicenseForOrder } from '../../services/paypal.js';
import { productForToken } from '../../services/product-tokens.js';
import { publicKeysFor } from '../../services/signing.js';
import { ensureLicenseForSession } from '../../services/stripe.js';
import { getProductBySlugGlobal } from '../../store/products.js';
import { registerLemonSqueezyRoutes } from './ls.js';
import { registerPortalRoutes } from './portal.js';
import { registerUsageRoutes } from './usage.js';

const activateBody = z.object({
	license_key: z.string(),
	instance_name: z.string().min(1),
});
const validateBody = z.object({
	license_key: z.string(),
	instance_id: z.string(),
});

async function readJson<T>(
	c: { req: { json: () => Promise<unknown> } },
	schema: z.ZodType<T>,
): Promise<T> {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw badRequest('Request body must be valid JSON.');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body.');
	}
	return parsed.data;
}

export function registerPublicRoutes(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/activate', async (c) => {
		const body = await readJson(c, activateBody);
		const result = await activate(deps, body.license_key, body.instance_name);
		return c.json({
			ok: true,
			license: serializeLicense(result.license, result.product, 'active'),
			instance: serializeInstance(result.activation),
		});
	});

	app.post('/v1/validate', async (c) => {
		const body = await readJson(c, validateBody);
		const result = await validate(deps, body.license_key, body.instance_id);
		return c.json({
			ok: true,
			valid: result.valid,
			license: serializeLicense(result.license, result.product, result.status),
			instance: result.activation ? serializeInstance(result.activation) : null,
			...(result.token ? { token: result.token } : {}),
		});
	});

	app.post('/v1/deactivate', async (c) => {
		const body = await readJson(c, validateBody);
		await deactivate(deps, body.license_key, body.instance_id);
		return c.json({ ok: true });
	});

	app.post('/v1/heartbeat', async (c) => {
		const body = await readJson(c, validateBody);
		const result = await heartbeat(deps, body.license_key, body.instance_id);
		return c.json({ ok: true, lease_expires_at: result.leaseExpiresAt });
	});

	// Public signing keys for offline token verification (SDK embeds these). PRD §11.
	app.get('/v1/pubkey', async (c) => {
		const slug = c.req.query('product');
		if (!slug) throw notFound('A product query parameter is required.');
		const product = await getProductBySlugGlobal(deps.db, slug);
		if (!product) throw notFound('No product with that slug.');
		const keys = await publicKeysFor(deps, product.id);
		return c.json({ ok: true, algorithm: 'ed25519', keys });
	});

	// Purchase lookup for a landing site's success page (PRD §13). Product-token authed
	// (per-product scope) with the global admin token accepted as a superset. Whichever of
	// {webhook, success page} runs first issues; this endpoint can ENSURE via the same
	// idempotent path when the webhook has not landed yet.
	app.get('/v1/purchase/session/:checkout_session_id', async (c) => {
		const header = c.req.header('Authorization') ?? '';
		const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
		const tokenProduct = presented ? await productForToken(deps, presented) : undefined;
		// Not a product token: require the global admin token (constant-time).
		if (!tokenProduct && !isAdminRequest(header, deps.config.adminToken)) {
			throw unauthorized();
		}

		const sessionId = c.req.param('checkout_session_id');
		let found = await findByCheckoutId(deps, sessionId);
		if (!found && deps.stripe) {
			// Success-page race: the webhook hasn't landed yet. Retrieve the paid session
			// from Stripe and issue through the same idempotent path (PRD §13/§14).
			const session = await deps.stripe.getCheckoutSession(sessionId);
			if (session) {
				const ensured = await ensureLicenseForSession(deps, session, `lookup:${sessionId}`);
				if (ensured) found = await findByCheckoutId(deps, sessionId);
			}
		}
		if (!found && deps.paypal) {
			// Same race on the PayPal side: the id is an order, not a Stripe session.
			const order = await deps.paypal.getOrder(sessionId);
			if (order) {
				const ensured = await ensureLicenseForOrder(deps, order, `lookup:${sessionId}`);
				if (ensured) found = await findByCheckoutId(deps, sessionId);
			}
		}
		if (!found) throw notFound('No purchase for that checkout session.');
		// A product-scoped token may only read its own product's purchases.
		if (tokenProduct && found.product.id !== tokenProduct.id) {
			throw notFound('No purchase for that checkout session.');
		}
		return c.json({
			ok: true,
			license: serializeLicense(found.license, found.product),
			email: found.email,
		});
	});

	registerUsageRoutes(app, deps);
	registerLemonSqueezyRoutes(app, deps);
	registerPortalRoutes(app, deps);
}
