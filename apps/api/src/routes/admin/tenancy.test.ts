// ABOUTME: The cross-tenant sweep — every admin route driven with one account's session against another's data.
// ABOUTME: Also fails when a new admin route appears without a tenancy assertion, so scoping cannot be forgotten.

import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { Config } from '../../config.js';
import { makeHarness } from '../../test/harness.js';
import { rawExec, rawQuery } from '../../test/pg.js';
import { createProduct, issueKey, signUp } from '../../test/seed.js';

const cloud: Partial<Config> = {
	// Billing configured is what puts the instance in cloud mode: signup is open, so two
	// accounts can exist at once.
	billing: { stripeSecretKey: 'sk_billing', proPriceId: 'price_pro' },
	logMagicCodes: true,
};

/** Two accounts, each with one product and one issued key. */
async function twoAccounts() {
	const h = await makeHarness({ config: cloud });
	const alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
	const bob = await signUp(h.app, h.logger, 'bob@beta.test', 'beta');
	await createProduct(
		h.app,
		{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
		alice,
	);
	await createProduct(
		h.app,
		{ slug: 'beta-app', name: 'Beta', key_prefix: 'BETA', email_from: 'b@beta.test' },
		bob,
	);
	const alphaKey = await issueKey(
		h.app,
		{ product: 'alpha-app', email: 'buyer@alpha.test', tier: 'lifetime' },
		alice,
	);
	const betaKey = await issueKey(
		h.app,
		{ product: 'beta-app', email: 'buyer@beta.test', tier: 'lifetime' },
		bob,
	);
	return { ...h, alice, bob, alphaKey, betaKey };
}

describe('signup creates separate accounts', () => {
	it('gives each signup its own account on the free plan', async () => {
		const h = await makeHarness({ config: cloud });
		await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		const accounts = await rawQuery<{ id: number; name: string; plan: string }>(
			'SELECT id, name, plan FROM accounts ORDER BY id',
		);
		// Account 1 is the migration's default; the signup gets its own, on free.
		expect(accounts).toHaveLength(2);
		expect(accounts[1]).toMatchObject({ name: 'alpha', plan: 'free' });
	});

	it('defaults the account name to the email domain', async () => {
		const h = await makeHarness({ config: cloud });
		await signUp(h.app, h.logger, 'alice@alpha.test');
		const row = (await rawQuery<{ name: string }>('SELECT name FROM accounts WHERE id = 2'))[0];
		expect(row.name).toBe('alpha.test');
	});

	it('keeps the closed bootstrap on self-host', async () => {
		// No billing configured. Once an admin exists, a stranger gets no code at all.
		const h = await makeHarness({ config: { logMagicCodes: true } });
		await signUp(h.app, h.logger, 'first@example.test');
		await expect(signUp(h.app, h.logger, 'stranger@example.test')).rejects.toThrow(/no magic code/);
	});
});

describe('cross-account reads', () => {
	it('404s another account product rather than 403, which would confirm it exists', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/products/alpha-app', { headers: bob });
		expect(res.status).toBe(404);
	});

	it.each([
		['GET', '/admin/products/alpha-app'],
		['PATCH', '/admin/products/alpha-app'],
		['DELETE', '/admin/products/alpha-app'],
		['GET', '/admin/products/alpha-app/keys'],
		['GET', '/admin/products/alpha-app/keys/export'],
		['POST', '/admin/products/alpha-app/metrics'],
		['POST', '/admin/products/alpha-app/signing-keys/rotate'],
		['POST', '/admin/products/alpha-app/token/rotate'],
		['POST', '/admin/products/alpha-app/stripe/connect'],
	])('%s %s is not reachable from another account', async (method, path) => {
		const { app, bob } = await twoAccounts();
		const res = await app.request(path, {
			method,
			headers: bob,
			...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify({ name: 'x' }) }),
		});
		expect(res.status).toBe(404);
	});

	it('404s another account key on every key route', async () => {
		const { app, bob, alphaKey } = await twoAccounts();
		for (const [method, path] of [
			['GET', `/admin/keys/${alphaKey}`],
			['POST', `/admin/keys/${alphaKey}/disable`],
			['POST', `/admin/keys/${alphaKey}/enable`],
		] as const) {
			const res = await app.request(path, { method, headers: bob });
			expect(res.status, `${method} ${path}`).toBe(404);
		}
	});

	it('refuses to issue a key against another account product', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/keys', {
			method: 'POST',
			headers: bob,
			body: JSON.stringify({ product: 'alpha-app', email: 'x@beta.test', tier: 'lifetime' }),
		});
		expect(res.status).toBe(404);
	});
});

describe('cross-account listings', () => {
	it('lists only the account own products', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/products', { headers: bob });
		const body = (await res.json()) as { products: { slug: string }[] };
		expect(body.products.map((p) => p.slug)).toEqual(['beta-app']);
	});

	it('counts only the account own rows in stats', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/stats', { headers: bob });
		const body = (await res.json()) as { stats: Record<string, number> };
		// One product, one licence. Raw SQL with global COUNT(*)s is exactly how this
		// endpoint used to answer, and it would report two of each.
		expect(body.stats.products).toBe(1);
		expect(body.stats.total_licenses).toBe(1);
		expect(body.stats.active_licenses).toBe(1);
	});

	it('shows only the account own team', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/team', { headers: bob });
		const body = (await res.json()) as { team: { email: string }[] };
		expect(body.team.map((m) => m.email)).toEqual(['bob@beta.test']);
	});

	it('shows only the account own audit trail', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/audit', { headers: bob });
		const body = (await res.json()) as { audit: { detail: unknown }[] };
		const serialized = JSON.stringify(body.audit);
		expect(serialized).not.toContain('alpha');
		expect(serialized).toContain('beta');
	});

	it('does not surface another account purchases by email search', async () => {
		const { app, bob } = await twoAccounts();
		// The email filter is free text, so without an account filter this reads across
		// tenants for anyone who can guess an address.
		const res = await app.request('/admin/purchases?email=buyer', { headers: bob });
		const body = (await res.json()) as { purchases: { email: string }[] };
		expect(body.purchases.map((p) => p.email)).toEqual(['buyer@beta.test']);
	});

	it('does not surface another account usage rows', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/usage', { headers: bob });
		const body = (await res.json()) as { usage: unknown[] };
		expect(JSON.stringify(body.usage)).not.toContain('alpha');
	});

	it('reports each account own plan and usage, never another account', async () => {
		const { app, alice, bob } = await twoAccounts();
		// Put Alice on Pro so the two accounts genuinely differ.
		await rawExec("UPDATE accounts SET plan = 'pro' WHERE name = 'alpha'");

		const alicePlan = (await (await app.request('/admin/billing', { headers: alice })).json()) as {
			billing: { plan: string; usage: { products: { current: number } } };
		};
		const bobPlan = (await (await app.request('/admin/billing', { headers: bob })).json()) as {
			billing: { plan: string; usage: { products: { current: number } } };
		};
		expect(alicePlan.billing.plan).toBe('pro');
		expect(bobPlan.billing.plan).toBe('free');
		// Usage counts each account's own products, not the instance's.
		expect(bobPlan.billing.usage.products.current).toBe(1);
	});

	it('charts validations for the account only', async () => {
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/validations', { headers: bob });
		expect(res.status).toBe(200);
	});
});

describe('cross-account team management', () => {
	it('refuses to invite someone who already belongs to another account', async () => {
		// Returning the existing row instead would silently hand this account an admin
		// whose sessions carry the other account id.
		const { app, bob } = await twoAccounts();
		const res = await app.request('/admin/team', {
			method: 'POST',
			headers: bob,
			body: JSON.stringify({ email: 'alice@alpha.test' }),
		});
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'email_in_use' });
	});

	it('cannot revoke another account admin', async () => {
		const { app, bob } = await twoAccounts();
		const alice = (
			await rawQuery<{ id: number }>("SELECT id FROM admin_users WHERE email = 'alice@alpha.test'")
		)[0];
		const res = await app.request(`/admin/team/${alice.id}`, { method: 'DELETE', headers: bob });
		expect(res.status).toBe(404);
	});

	it('protects the last admin per account, not instance-wide', async () => {
		// Two accounts exist with one admin each, so an instance-wide count would see two
		// admins and happily remove one account's only way in.
		const { app, bob } = await twoAccounts();
		const self = (
			await rawQuery<{ id: number }>("SELECT id FROM admin_users WHERE email = 'bob@beta.test'")
		)[0];
		const res = await app.request(`/admin/team/${self.id}`, { method: 'DELETE', headers: bob });
		expect(res.status).toBe(409);
		expect((await res.json()) as { error: string }).toMatchObject({ error: 'last_admin' });
	});
});

describe('the ADMIN_TOKEN credential', () => {
	it('acts in the only account when a self-host instance has just the one', async () => {
		const h = await makeHarness();
		const res = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(res.status).toBe(200);
	});

	it('refuses to guess once more than one account exists', async () => {
		const h = await makeHarness({
			config: { ...cloud, adminToken: 'test-admin-token-0123456789' },
		});
		await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		const res = await h.app.request('/admin/products', { headers: h.adminHeaders });
		expect(res.status).toBe(400);
		expect(await res.text()).toContain('X-Coolbeans-Account');
	});

	it('acts in the named account when the header says which', async () => {
		const h = await makeHarness({
			config: { ...cloud, adminToken: 'test-admin-token-0123456789' },
		});
		const alice = await signUp(h.app, h.logger, 'alice@alpha.test', 'alpha');
		await createProduct(
			h.app,
			{ slug: 'alpha-app', name: 'Alpha', key_prefix: 'ALPHA', email_from: 'a@alpha.test' },
			alice,
		);
		const res = await h.app.request('/admin/products', {
			headers: { ...h.adminHeaders, 'X-Coolbeans-Account': 'alpha' },
		});
		const body = (await res.json()) as { products: { slug: string }[] };
		expect(body.products.map((p) => p.slug)).toEqual(['alpha-app']);
	});

	it('refuses an ambiguous account name rather than picking one', async () => {
		// Names are not unique, and two signups from the same email domain both default to
		// that domain, so this collision is likely rather than exotic. Resolving it to
		// whichever row came back first would act on an arbitrary tenant's data.
		const h = await makeHarness({
			config: { ...cloud, adminToken: 'test-admin-token-0123456789' },
		});
		await signUp(h.app, h.logger, 'one@acme.test', 'acme.test');
		await signUp(h.app, h.logger, 'two@acme.test', 'acme.test');
		const res = await h.app.request('/admin/products', {
			headers: { ...h.adminHeaders, 'X-Coolbeans-Account': 'acme.test' },
		});
		expect(res.status).toBe(400);
		expect(await res.text()).toContain('numeric id');
	});

	it('resolves an ambiguous name when the id is given instead', async () => {
		const h = await makeHarness({
			config: { ...cloud, adminToken: 'test-admin-token-0123456789' },
		});
		const one = await signUp(h.app, h.logger, 'one@acme.test', 'acme.test');
		await signUp(h.app, h.logger, 'two@acme.test', 'acme.test');
		await createProduct(
			h.app,
			{ slug: 'one-app', name: 'One', key_prefix: 'ONE', email_from: 'a@acme.test' },
			one,
		);
		const res = await h.app.request('/admin/products', {
			headers: { ...h.adminHeaders, 'X-Coolbeans-Account': '2' },
		});
		const body = (await res.json()) as { products: { slug: string }[] };
		expect(body.products.map((p) => p.slug)).toEqual(['one-app']);
	});

	it('is not a credential at all when no admin token is configured', async () => {
		// The hosted deployment leaves ADMIN_TOKEN unset so this bypass does not exist.
		const h = await makeHarness({ config: { ...cloud, adminToken: undefined } });
		const res = await h.app.request('/admin/products', {
			headers: { Authorization: 'Bearer test-admin-token-0123456789' },
		});
		expect(res.status).toBe(401);
	});
});

/**
 * The forcing function. Every admin route has to be named here, so adding one without
 * thinking about tenancy fails this test rather than shipping a cross-tenant read.
 *
 * Adding a route to this list is a claim that its tenancy behaviour is covered above.
 */
const COVERED = new Set([
	'GET /admin/billing',
	// Both act on accountScope alone and take no id from the caller, so there is no
	// cross-account target to aim them at. The reachability rule that matters for these
	// is that a cbp_ product token is refused, pinned in billing.test.ts.
	'POST /admin/billing/checkout',
	'POST /admin/billing/portal',
	'GET /admin/products',
	'POST /admin/products',
	'GET /admin/products/:slug',
	'PATCH /admin/products/:slug',
	'DELETE /admin/products/:slug',
	'GET /admin/products/:slug/keys',
	'GET /admin/products/:slug/keys/export',
	'POST /admin/products/:slug/metrics',
	'POST /admin/products/:slug/signing-keys/rotate',
	'POST /admin/products/:slug/token/rotate',
	'POST /admin/products/:slug/stripe/connect',
	'POST /admin/keys',
	'GET /admin/keys/:key',
	'POST /admin/keys/:key/disable',
	'POST /admin/keys/:key/enable',
	// Cross-account case lives in offline-activation.test.ts alongside the rest of its
	// behaviour: another account's key is 404 and takes no seat.
	'POST /admin/keys/:key/offline-activation',
	'GET /admin/purchases',
	'GET /admin/team',
	'POST /admin/team',
	'DELETE /admin/team/:id',
	'GET /admin/stats',
	'GET /admin/audit',
	'GET /admin/validations',
	'GET /admin/usage',
	'GET /admin/events',
	'GET /admin/providers',
	'GET /admin/time',
]);

describe('route inventory', () => {
	it('has a tenancy assertion for every admin route', async () => {
		const { deps } = await makeHarness();
		const app = createApp(deps);
		const seen = new Set(
			app.routes
				.filter((r) => r.path.startsWith('/admin') && r.method !== 'ALL')
				.map((r) => `${r.method} ${r.path}`),
		);
		const unlisted = [...seen].filter((r) => !COVERED.has(r)).sort();
		expect(
			unlisted,
			`New admin route(s) with no tenancy assertion. Add a cross-account case to this file, then list them in COVERED: ${unlisted.join(', ')}`,
		).toEqual([]);
	});
});
