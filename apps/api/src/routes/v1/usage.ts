// ABOUTME: Usage metering routes (PRD §9, §12) — increment enforces the quota, GET reads counters.
// ABOUTME: Over-limit returns 429 quota_exceeded with the same body shape as success.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { getUsage, incrementUsage } from '../../services/usage.js';

const incrementBody = z.object({
	license_key: z.string(),
	instance_id: z.string().optional(),
	metric: z.string().min(1),
	delta: z.number().int().positive().default(1),
});

export function registerUsageRoutes(app: OpenAPIHono, deps: AppDeps): void {
	app.post('/v1/usage/increment', async (c) => {
		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			throw badRequest('Request body must be valid JSON.');
		}
		const parsed = incrementBody.safeParse(raw);
		if (!parsed.success)
			throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body.');
		const state = incrementUsage(
			deps,
			parsed.data.license_key,
			parsed.data.metric,
			parsed.data.delta,
		);
		return c.json({
			ok: true,
			current: state.current,
			limit: state.limit,
			resets_at: state.resetsAt,
		});
	});

	app.get('/v1/usage', async (c) => {
		const key = c.req.query('license_key');
		if (!key) throw badRequest('license_key query parameter is required.');
		const counters = getUsage(deps, key);
		return c.json({ ok: true, usage: counters });
	});
}
