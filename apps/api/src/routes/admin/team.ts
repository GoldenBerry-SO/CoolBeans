// ABOUTME: Team routes (PRD §16) — list, invite, and revoke console admins.
// ABOUTME: Revoking drops live sessions immediately; the last admin is protected.

import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { conflict, notFound } from '../../http/errors.js';
import { inviteAdmin, listTeam, revokeAdmin } from '../../services/console-auth.js';
import { accountScope, auditActor, readBody } from './util.js';

const inviteBody = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(80).optional(),
});

export function registerAdminTeamRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/team', async (c) =>
		c.json({
			ok: true,
			team: (await listTeam(deps, accountScope(c).id)).map((m) => ({
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
		const invited = await inviteAdmin(
			deps,
			accountScope(c).id,
			body.email,
			auditActor(c),
			body.name,
		);
		if (invited === 'email_in_use') {
			// They already belong to another account. Returning that row instead would hand
			// this account an admin whose sessions carry someone else's account id.
			throw conflict('email_in_use', 'That email already belongs to another account.');
		}
		const m = invited;
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

	admin.delete('/team/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) throw notFound('No admin with that id.');
		const result = await revokeAdmin(deps, accountScope(c).id, id, auditActor(c));
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
