// ABOUTME: Combined console auth — magic-code session (cbs_…), env admin token, or product token.
// ABOUTME: Every path resolves an owning account, so /admin handlers always have one in hand.

import type { Account } from '@coolbeans/db';
import type { MiddlewareHandler } from 'hono';
import type { AppDeps } from '../deps.js';
import { badRequest, forbidden, unauthorized } from '../http/errors.js';
import { adminForSession } from '../services/console-auth.js';
import { productForToken } from '../services/product-tokens.js';
import {
	countAccounts,
	findAccountsByName,
	getAccountById,
	listAccounts,
} from '../store/accounts.js';
import { isAdminRequest } from './admin-auth.js';

/**
 * Names the account an ADMIN_TOKEN request acts inside. Only consulted for that
 * credential: a session and a product token both carry their own account already.
 */
const ACCOUNT_HEADER = 'X-Coolbeans-Account';

/**
 * Paths a per-product token may reach, as regexes against the path after /admin.
 * Default-deny: anything not listed here is account-wide (team, stats, audit, billing,
 * product creation, token rotation) and belongs to a full admin. Ownership of the named
 * product is checked separately in the handlers.
 */
const PRODUCT_SCOPED: { method: string; path: RegExp }[] = [
	{ method: 'GET', path: /^\/products$/ },
	{ method: 'GET', path: /^\/products\/[^/]+$/ },
	{ method: 'PATCH', path: /^\/products\/[^/]+$/ },
	{ method: 'GET', path: /^\/products\/[^/]+\/keys$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/metrics$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/signing-keys\/rotate$/ },
	{ method: 'POST', path: /^\/products\/[^/]+\/stripe\/connect$/ },
	{ method: 'POST', path: /^\/keys$/ },
	{ method: 'GET', path: /^\/keys\/[^/]+$/ },
	{ method: 'POST', path: /^\/keys\/[^/]+\/(disable|enable)$/ },
	{ method: 'GET', path: /^\/purchases$/ },
	{ method: 'GET', path: /^\/usage$/ },
];

function scopeAllows(method: string, path: string): boolean {
	return PRODUCT_SCOPED.some((r) => r.method === method && r.path.test(path));
}

/**
 * Which account an ADMIN_TOKEN request acts inside.
 *
 * The token is instance-wide with no user record behind it, so there is no account it
 * naturally belongs to. Self-host has exactly one account and never has to say, which is
 * what keeps the CLI and the existing tests working untouched. Past that, it has to name
 * one — guessing would mean acting on an arbitrary tenant's data.
 */
function accountForAdminToken(deps: AppDeps, header: string | undefined): Account {
	if (header) {
		const trimmed = header.trim();
		const byId = /^\d+$/.test(trimmed) ? getAccountById(deps.db, Number(trimmed)) : undefined;
		if (byId) return byId;
		// Names are not unique, so an ambiguous one has to be refused rather than resolved
		// to whichever row came back first — that would act on an arbitrary tenant.
		const byName = findAccountsByName(deps.db, trimmed);
		if (byName.length > 1) {
			throw badRequest(
				`More than one account is named "${trimmed}". Use its numeric id in ${ACCOUNT_HEADER} instead.`,
			);
		}
		const account = byName[0];
		if (!account) throw badRequest(`No account matches ${ACCOUNT_HEADER}: ${trimmed}`);
		return account;
	}
	if (countAccounts(deps.db) === 1) {
		const only = listAccounts(deps.db)[0];
		if (only) return only;
	}
	throw badRequest(
		`This instance has more than one account, so ${ACCOUNT_HEADER} must name the one to act in (its id or name).`,
	);
}

export function consoleAuth(deps: AppDeps): MiddlewareHandler {
	return async (c, next) => {
		const header = c.req.header('Authorization') ?? '';
		if (isAdminRequest(header, deps.config.adminToken)) {
			c.set('accountScope', accountForAdminToken(deps, c.req.header(ACCOUNT_HEADER)));
			await next();
			return;
		}
		const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
		if (!presented) throw unauthorized();

		const session = adminForSession(deps, presented);
		if (session) {
			const account = getAccountById(deps.db, session.accountId);
			// The session names an account that has since vanished. Treat it as signed out
			// rather than falling back to a default, which would be a cross-tenant read.
			if (!account) throw unauthorized();
			c.set('adminEmail', session.admin.email);
			c.set('accountScope', account);
			await next();
			return;
		}

		const product = productForToken(deps, presented);
		if (!product) throw unauthorized();
		const path = new URL(c.req.url).pathname.replace(/^\/admin/, '');
		if (!scopeAllows(c.req.method, path)) {
			throw forbidden('This token is scoped to one product and cannot reach that endpoint.');
		}
		const account = getAccountById(deps.db, product.accountId);
		if (!account) throw unauthorized();
		c.set('productScope', product);
		c.set('accountScope', account);
		await next();
	};
}
