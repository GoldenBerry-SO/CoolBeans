// ABOUTME: Public client API routes (PRD §9) — the frozen activate/validate/deactivate/heartbeat contract.
// ABOUTME: Every body carries `ok`; the key is the credential, no service secret required.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest, notFound } from '../../http/errors.js';
import { serializeInstance, serializeLicense } from '../../http/serializers.js';
import { adminAuth } from '../../middleware/admin-auth.js';
import { activate, deactivate, heartbeat, validate } from '../../services/licensing.js';
import { findByCheckoutId } from '../../services/payments.js';
import { publicKeysFor } from '../../services/signing.js';
import { getProductBySlug } from '../../store/products.js';
import { registerLemonSqueezyRoutes } from './ls.js';
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
		const result = activate(deps, body.license_key, body.instance_name);
		return c.json({
			ok: true,
			license: serializeLicense(result.license, result.product, 'active'),
			instance: serializeInstance(result.activation),
		});
	});

	app.post('/v1/validate', async (c) => {
		const body = await readJson(c, validateBody);
		const result = validate(deps, body.license_key, body.instance_id);
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
		deactivate(deps, body.license_key, body.instance_id);
		return c.json({ ok: true });
	});

	app.post('/v1/heartbeat', async (c) => {
		const body = await readJson(c, validateBody);
		const result = heartbeat(deps, body.license_key, body.instance_id);
		return c.json({ ok: true, lease_expires_at: result.leaseExpiresAt });
	});

	// Public signing keys for offline token verification (SDK embeds these). PRD §11.
	app.get('/v1/pubkey', (c) => {
		const slug = c.req.query('product');
		if (!slug) throw notFound('A product query parameter is required.');
		const product = getProductBySlug(deps.db, slug);
		if (!product) throw notFound('No product with that slug.');
		return c.json({ ok: true, algorithm: 'ed25519', keys: publicKeysFor(deps, product.id) });
	});

	// Purchase lookup for a landing site's success page (PRD §13). Admin-token authed —
	// the success page calls this server-side with the token held server-side.
	app.get('/v1/purchase/session/:checkout_session_id', adminAuth(deps.config.adminToken), (c) => {
		const found = findByCheckoutId(deps, c.req.param('checkout_session_id'));
		if (!found) throw notFound('No purchase for that checkout session.');
		return c.json({
			ok: true,
			license: serializeLicense(found.license, found.product),
			email: found.email,
		});
	});

	registerUsageRoutes(app, deps);
	registerLemonSqueezyRoutes(app, deps);
}
