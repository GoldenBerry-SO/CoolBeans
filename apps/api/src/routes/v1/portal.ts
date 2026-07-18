// ABOUTME: Customer portal API (PRD §15) — key-authed self-service lookup and seat management.
// ABOUTME: The key is the credential; a buyer sees their license + devices and can free a seat.

import { activations } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { nowDate } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { serializeLicense } from '../../http/serializers.js';
import { resolveLicense } from '../../services/licensing.js';

const lookupBody = z.object({ license_key: z.string() });

export function registerPortalRoutes(app: OpenAPIHono, deps: AppDeps): void {
	// Look up a license by its key and list live devices. Key is the credential (no login).
	app.post('/v1/portal/lookup', async (c) => {
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			throw badRequest('Request body must be valid JSON.');
		}
		const parsed = lookupBody.safeParse(raw);
		if (!parsed.success) throw badRequest('A license_key is required.');
		const resolved = resolveLicense(deps, parsed.data.license_key);
		const nowIso = nowDate(deps).toISOString();
		const leaseCondition =
			resolved.product.activationModel === 'floating'
				? sql`${activations.leaseExpiresAt} > ${nowIso}`
				: sql`1 = 1`;
		const devices = deps.db
			.select()
			.from(activations)
			.where(
				and(
					eq(activations.licenseId, resolved.license.id),
					isNull(activations.deactivatedAt),
					leaseCondition,
				),
			)
			.orderBy(desc(activations.createdAt))
			.all();
		return c.json({
			ok: true,
			license: serializeLicense(resolved.license, resolved.product, resolved.status),
			download_url: resolved.product.downloadUrl ?? null,
			activations: devices.map((d) => ({
				instance_id: d.instanceId,
				name: d.name,
				created_at: d.createdAt,
				last_validated_at: d.lastValidatedAt,
			})),
		});
	});
}
