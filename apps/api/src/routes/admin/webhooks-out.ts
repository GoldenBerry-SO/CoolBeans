// ABOUTME: Admin routes for outbound webhooks (issue #108) — endpoint CRUD and the delivery log.
// ABOUTME: The signing secret appears exactly once, at creation or rotation, like product tokens.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/errors.js';
import {
	createWebhookEndpoint,
	disableWebhookEndpoint,
	listWebhookDeliveries,
	listWebhookEndpoints,
	rotateWebhookSecret,
	WEBHOOK_EVENT_TYPES,
} from '../../services/webhooks-out.js';
import { writeAudit } from '../../store/audit.js';
import { accountScope, auditActor, readBody, requireProduct } from './util.js';

const endpointBody = z.object({
	url: z.string().min(1),
	events: z.array(z.string()).min(1),
	/** Product slug to scope this endpoint to. Omit for every product in the account. */
	product: z.string().min(1).optional(),
});

export function registerAdminWebhookRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/webhooks/event-types', (c) => c.json({ ok: true, event_types: WEBHOOK_EVENT_TYPES }));

	admin.get('/webhooks/endpoints', async (c) => {
		const endpoints = await listWebhookEndpoints(deps, accountScope(c).id);
		return c.json({ ok: true, endpoints });
	});

	admin.post('/webhooks/endpoints', async (c) => {
		const account = accountScope(c);
		const body = await readBody(c, endpointBody);
		// requireProduct scopes to the caller's account, so another tenant's slug is a 404
		// rather than a 403 and never confirms the product exists somewhere else.
		const product = body.product ? await requireProduct(c, deps, body.product) : undefined;
		const endpoint = await createWebhookEndpoint(deps, {
			accountId: account.id,
			url: body.url,
			events: body.events,
			productId: product?.id ?? null,
		});
		await writeAudit(deps.db, {
			action: 'webhook_endpoint.created',
			actor: auditActor(c),
			accountId: account.id,
			detail: { url: endpoint.url, events: endpoint.events, product: product?.slug ?? null },
		});
		return c.json({ ok: true, endpoint });
	});

	admin.post('/webhooks/endpoints/:id/rotate', async (c) => {
		const account = accountScope(c);
		const id = Number(c.req.param('id'));
		const secret = Number.isInteger(id) ? await rotateWebhookSecret(deps, account.id, id) : null;
		// Cross-account is 404, never 403: a 403 confirms the id exists somewhere else.
		if (!secret) throw notFound('No webhook endpoint with that id.');
		await writeAudit(deps.db, {
			action: 'webhook_endpoint.secret_rotated',
			actor: auditActor(c),
			accountId: account.id,
			detail: { endpoint: id },
		});
		return c.json({ ok: true, secret });
	});

	admin.delete('/webhooks/endpoints/:id', async (c) => {
		const account = accountScope(c);
		const id = Number(c.req.param('id'));
		const disabled = Number.isInteger(id)
			? await disableWebhookEndpoint(deps, account.id, id)
			: false;
		if (!disabled) throw notFound('No webhook endpoint with that id.');
		await writeAudit(deps.db, {
			action: 'webhook_endpoint.disabled',
			actor: auditActor(c),
			accountId: account.id,
			detail: { endpoint: id },
		});
		return c.json({ ok: true });
	});

	admin.get('/webhooks/endpoints/:id/deliveries', async (c) => {
		const account = accountScope(c);
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) throw notFound('No webhook endpoint with that id.');
		// The join inside scopes by account; a foreign endpoint yields an empty list, and
		// an empty list for a foreign id is indistinguishable from a fresh endpoint — but
		// the list surface must still 404 so the id's existence is not confirmed.
		const endpoints = await listWebhookEndpoints(deps, account.id);
		if (!endpoints.some((e) => e.id === id)) throw notFound('No webhook endpoint with that id.');
		const deliveries = await listWebhookDeliveries(deps, account.id, id);
		return c.json({ ok: true, deliveries });
	});
}
