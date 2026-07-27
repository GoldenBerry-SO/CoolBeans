// ABOUTME: Signed entitlements (#76) — a grant says which capabilities a price buys, snapshotted
// ABOUTME: onto the licence at issuance and signed into the offline token. Never a display label.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeStripeGateway, makeHarness, type TestHarness } from '../test/harness.js';
import { rawQuery } from '../test/pg.js';
import { createProduct, seedGrant } from '../test/seed.js';

let h: TestHarness;
let productId: number;

const PRICE_BASIC = 'price_clemBasic';
const PRICE_PRO = 'price_clemPro';
const BASIC = { export_4k: false, batch_limit: 10 };
const PRO = { export_4k: true, batch_limit: 100 };

beforeEach(async () => {
	h = await makeHarness();
	h.deps.config.stripe = { secretKey: 'sk_test', webhookSecret: 'whsec_test' };
	h.deps.stripe = fakeStripeGateway(
		{},
		{ cs_basic: [PRICE_BASIC], cs_pro: [PRICE_PRO] },
		{ prices: { [PRICE_BASIC]: { recurring: false }, [PRICE_PRO]: { recurring: false } } },
	);
	const product = await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
	productId = product.id as number;
});

/** Pay for a price and return the issued licence key. */
async function buy(session: string, event: string): Promise<string> {
	const res = await h.app.request('/v1/stripe/webhook', {
		method: 'POST',
		headers: { 'stripe-signature': 'valid', 'Content-Type': 'application/json' },
		body: JSON.stringify({
			id: event,
			type: 'checkout.session.completed',
			data: {
				object: {
					id: session,
					mode: 'payment',
					payment_status: 'paid',
					customer_email: `${session}@example.com`,
					payment_intent: `pi_${session}`,
				},
			},
		}),
	});
	expect(res.status).toBe(200);
	const keys = await h.app.request(
		`/admin/products/clementine/keys?email=${encodeURIComponent(`${session}@example.com`)}`,
		{ headers: h.adminHeaders },
	);
	const body = (await keys.json()) as { keys: Array<{ key: string }> };
	const key = body.keys[0]?.key;
	if (!key) throw new Error(`no key issued for ${session}`);
	return key;
}

/** Activate, validate, and hand back the decoded token payload the SDK would verify. */
async function tokenPayload(key: string): Promise<Record<string, unknown>> {
	const act = await h.app.request('/v1/activate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ license_key: key, instance_name: 'Mac' }),
	});
	const { instance } = (await act.json()) as { instance: { id: string } };
	const val = await h.app.request('/v1/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ license_key: key, instance_id: instance.id }),
	});
	const { token } = (await val.json()) as { token: string };
	const part = token.split('.')[1] as string;
	return JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;
}

async function licenceRow(key: string): Promise<Record<string, unknown>> {
	const rows = await rawQuery<Record<string, unknown>>(
		'SELECT entitlements, plan FROM licenses WHERE key = $1',
		[key.replace(/-/g, '').toUpperCase()],
	);
	const row = rows[0];
	if (!row) throw new Error('licence not found');
	return row;
}

describe('a grant carries the capabilities a price buys', () => {
	it('stores entitlements when a price is mapped', async () => {
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				stripe_price_id: PRICE_PRO,
				kind: 'perpetual',
				plan: 'Pro',
				entitlements: PRO,
			}),
		});
		expect(res.status).toBe(200);
		const { grant } = (await res.json()) as { grant: { entitlements: unknown } };
		expect(grant.entitlements).toEqual(PRO);
	});

	it('keeps what the price already grants when they are omitted', async () => {
		const map = (body: Record<string, unknown>) =>
			h.app.request('/admin/products/clementine/grants', {
				method: 'POST',
				headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
				body: JSON.stringify({ stripe_price_id: PRICE_PRO, kind: 'perpetual', ...body }),
			});
		await map({ entitlements: PRO });
		// Re-mapping to fix a label must not quietly strip the capabilities customers pay for.
		const res = await map({ plan: 'Pro (annual)' });
		const { grant } = (await res.json()) as { grant: { entitlements: unknown; plan: string } };
		expect(grant.entitlements).toEqual(PRO);
		expect(grant.plan).toBe('Pro (annual)');
	});

	it('stores nothing for an empty map on a new mapping', async () => {
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				stripe_price_id: PRICE_PRO,
				kind: 'perpetual',
				entitlements: {},
			}),
		});
		const { grant } = (await res.json()) as { grant: { entitlements: unknown } };
		// Absent and empty are the same fact here: this price grants no capabilities.
		expect(grant.entitlements).toBeNull();
	});

	const remap = (body: Record<string, unknown>) =>
		h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ stripe_price_id: PRICE_PRO, kind: 'perpetual', ...body }),
		});

	it('keeps what the price already grants when they are omitted', async () => {
		await remap({ entitlements: PRO });
		// Re-mapping to fix a label must not quietly strip the capabilities customers pay for.
		const res = await remap({ plan: 'Pro (annual)' });
		const { grant } = (await res.json()) as { grant: { entitlements: unknown; plan: string } };
		expect(grant.entitlements).toEqual(PRO);
		expect(grant.plan).toBe('Pro (annual)');
	});

	it('clears them when an empty map is sent deliberately', async () => {
		// Omitted means keep, and an empty map is the only way to say "this price grants none any
		// more". Without it an operator has to retire and remap to take a capability off a price,
		// and the route promising `{}` means none would be a promise nothing kept.
		await remap({ entitlements: PRO });
		const res = await remap({ entitlements: {} });
		const { grant } = (await res.json()) as { grant: { entitlements: unknown } };
		expect(grant.entitlements).toBeNull();
	});

	it('leaves licences already issued alone when a price stops granting them', async () => {
		// The snapshot is the whole point: taking a capability off a price is about what it sells
		// next, never about what somebody already bought.
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_PRO,
			kind: 'perpetual',
			entitlements: PRO,
		});
		const key = await buy('cs_pro', 'evt_pro');
		await rawQuery('UPDATE license_grants SET entitlements = NULL WHERE stripe_price_id = $1', [
			PRICE_PRO,
		]);
		expect((await licenceRow(key)).entitlements).toEqual(PRO);
	});

	it('refuses a name an app cannot read as a property', async () => {
		// An app reads these as `state.entitlements?.export_4k`. A name with a dot or a space in it
		// looks like a nested path and is not one, so the console refuses it — and the API has to
		// agree, or the console is the only thing holding the contract.
		for (const name of ['limits.batch', 'has space', '4k', '']) {
			const res = await h.app.request('/admin/products/clementine/grants', {
				method: 'POST',
				headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					stripe_price_id: PRICE_PRO,
					kind: 'perpetual',
					entitlements: { [name]: true },
				}),
			});
			expect(res.status, name).toBeGreaterThanOrEqual(400);
		}
	});

	it('refuses a map big enough to bloat every token it signs', async () => {
		// These are signed into every token the price issues, and the token lives in an app's
		// storage and travels on every validate. An unbounded blob is not a capability map.
		const huge = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`cap_${i}`, true]));
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				stripe_price_id: PRICE_PRO,
				kind: 'perpetual',
				entitlements: huge,
			}),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it('refuses anything but flat scalar values', async () => {
		// Nested objects have no meaning to an app and would sign an unbounded blob into every
		// token. A flat map of booleans, numbers and strings is the whole contract.
		const res = await h.app.request('/admin/products/clementine/grants', {
			method: 'POST',
			headers: { ...h.adminHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				stripe_price_id: PRICE_PRO,
				kind: 'perpetual',
				entitlements: { limits: { batch: 10 } },
			}),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});

describe('issuance snapshots the entitlements', () => {
	it('copies them onto the licence, so re-pricing later changes nothing already sold', async () => {
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_PRO,
			kind: 'perpetual',
			plan: 'Pro',
			entitlements: PRO,
		});
		const key = await buy('cs_pro', 'evt_pro');
		expect((await licenceRow(key)).entitlements).toEqual(PRO);

		// The vendor moves 4k export to a higher tier tomorrow. What was already bought stands.
		await rawQuery('UPDATE license_grants SET entitlements = $1 WHERE stripe_price_id = $2', [
			JSON.stringify({ export_4k: false }),
			PRICE_PRO,
		]);
		expect((await licenceRow(key)).entitlements).toEqual(PRO);
	});

	it('sells two tiers from one product, differing in capability', async () => {
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_BASIC,
			kind: 'perpetual',
			plan: 'Basic',
			entitlements: BASIC,
		});
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_PRO,
			kind: 'perpetual',
			plan: 'Pro',
			entitlements: PRO,
		});
		const basic = await buy('cs_basic', 'evt_basic');
		const pro = await buy('cs_pro', 'evt_pro');
		expect((await licenceRow(basic)).entitlements).toEqual(BASIC);
		expect((await licenceRow(pro)).entitlements).toEqual(PRO);
	});

	it('leaves a licence with no entitlements exactly as it was', async () => {
		await seedGrant(h.deps, { productId, priceId: PRICE_BASIC, kind: 'perpetual' });
		const key = await buy('cs_basic', 'evt_plain');
		expect((await licenceRow(key)).entitlements).toBeNull();
	});
});

describe('the offline token carries them, signed', () => {
	it('signs them into the token so an offline app needs no call', async () => {
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_PRO,
			kind: 'perpetual',
			entitlements: PRO,
		});
		const payload = await tokenPayload(await buy('cs_pro', 'evt_pro'));
		expect(payload.entitlements).toEqual(PRO);
	});

	it('omits the claim for an empty map too, not just a missing one', async () => {
		// Belt and braces at the boundary that matters. A licence row carrying `{}` — set by hand,
		// or by some future path — must not sign a claim that says "there is a capability map"
		// when there is nothing in it.
		await seedGrant(h.deps, { productId, priceId: PRICE_BASIC, kind: 'perpetual' });
		const key = await buy('cs_basic', 'evt_plain');
		await rawQuery('UPDATE licenses SET entitlements = $1', ['{}']);
		const payload = await tokenPayload(key);
		expect('entitlements' in payload).toBe(false);
	});

	it('omits the claim entirely when a licence has none', async () => {
		// Absent, not an empty object: an app checking `state.entitlements?.x` must not be told
		// there is a capability map when the vendor never authored one.
		await seedGrant(h.deps, { productId, priceId: PRICE_BASIC, kind: 'perpetual' });
		const payload = await tokenPayload(await buy('cs_basic', 'evt_plain'));
		expect('entitlements' in payload).toBe(false);
	});

	it('keeps the frozen §9 licence object exactly as it is', async () => {
		// Entitlements are only trustworthy signed, so the token is their only carrier. The
		// public licence object does not grow a field.
		await seedGrant(h.deps, {
			productId,
			priceId: PRICE_PRO,
			kind: 'perpetual',
			entitlements: PRO,
		});
		const key = await buy('cs_pro', 'evt_pro');
		const res = await h.app.request('/v1/activate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ license_key: key, instance_name: 'Mac' }),
		});
		const { license } = (await res.json()) as { license: Record<string, unknown> };
		expect(Object.keys(license).sort()).toEqual(
			['key', 'status', 'kind', 'plan', 'product', 'expires_at'].sort(),
		);
	});
});
