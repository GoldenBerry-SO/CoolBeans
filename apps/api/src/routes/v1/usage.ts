// ABOUTME: Usage metering routes (PRD §9, §12) — increment enforces the quota, GET reads counters.
// ABOUTME: Over-limit returns 429 quota_exceeded carrying the same current/limit/resets_at fields.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { badRequest } from '../../http/errors.js';
import { getUsage, incrementUsage } from '../../services/usage.js';

const incrementBody = z.object({
	license_key: z.string(),
	// §9 includes instance_id in the increment request, so it is required. Quota is
	// currently counted per license, not per instance: a live-instance check would
	// add a rejection the frozen contract does not define. Tracked for a decision.
	instance_id: z.string().min(1),
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
		const result = incrementUsage(
			deps,
			parsed.data.license_key,
			parsed.data.metric,
			parsed.data.delta,
		);
		if (result.exceeded) {
			// §9: the 429 carries the same body shape as success.
			return c.json(
				{
					ok: false,
					error: 'quota_exceeded',
					message: 'This usage quota has been reached.',
					current: result.state.current,
					limit: result.state.limit,
					resets_at: result.state.resetsAt,
				},
				429,
			);
		}
		return c.json({
			ok: true,
			current: result.state.current,
			limit: result.state.limit,
			resets_at: result.state.resetsAt,
		});
	});

	app.get('/v1/usage', async (c) => {
		const key = c.req.query('license_key');
		if (!key) throw badRequest('license_key query parameter is required.');
		const counters = getUsage(deps, key);
		return c.json({ ok: true, usage: counters });
	});
}
