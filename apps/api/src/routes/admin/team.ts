// ABOUTME: Team routes (PRD §16) — list, invite, and revoke console admins.
// ABOUTME: Revoking drops live sessions immediately; the last admin is protected.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { conflict, notFound } from '../../http/errors.js';
import { inviteAdmin, listTeam, revokeAdmin } from '../../services/console-auth.js';
import { auditActor, readBody } from './util.js';

const inviteBody = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(80).optional(),
});

export function registerAdminTeamRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/team', (c) =>
		c.json({
			ok: true,
			team: listTeam(deps).map((m) => ({
				id: m.id,
				email: m.email,
				name: m.name,
				created_at: m.createdAt,
				last_login_at: m.lastLoginAt,
			})),
		}),
	);

	admin.post('/team', async (c) => {
		const body = await readBody(c, inviteBody);
		const m = inviteAdmin(deps, body.email, auditActor(c), body.name);
		return c.json({
			ok: true,
			member: {
				id: m.id,
				email: m.email,
				name: m.name,
				created_at: m.createdAt,
				last_login_at: m.lastLoginAt,
			},
		});
	});

	admin.delete('/team/:id', (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) throw notFound('No admin with that id.');
		const result = revokeAdmin(deps, id, auditActor(c));
		if (result === 'not_found') throw notFound('No admin with that id.');
		if (result === 'last_admin') {
			throw conflict(
				'last_admin',
				'This is the only admin left. Invite someone else before removing this account.',
			);
		}
		return c.json({ ok: true });
	});
}
