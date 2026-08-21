// ABOUTME: Outbound webhooks (issue #108) — vendors register URLs, we POST signed lifecycle events.
// ABOUTME: Emission is best-effort off the hot paths; delivery rides the outbox for retries.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { License, Product, WebhookEndpoint } from '@coolbeans/db';
import { products, purchases, webhookDeliveries, webhookEndpoints } from '@coolbeans/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate, withTx } from '../deps.js';
import { decryptSecret, encryptSecret } from '../domain/crypto.js';
import { validationError } from '../http/errors.js';
import { serializeLicense } from '../http/serializers.js';
import { enqueue } from './outbox.js';

/**
 * The event vocabulary. license.disabled carries its reason (refund, trial_expired, …)
 * in the payload rather than splitting into more types: one revocation event, one branch.
 */
export const WEBHOOK_EVENT_TYPES = [
	'license.issued',
	'license.disabled',
	'license.reenabled',
	'license.expiry_extended',
	'activation.created',
	'activation.deactivated',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Give up after this many failed attempts; the delivery row records the whole ride. */
export const DELIVERY_MAX_ATTEMPTS = 5;

/**
 * Hosts a CLOUD tenant may not point us at. Self-host skips this: the operator owns
 * their network and internal receivers are legitimate there. This blocks the obvious
 * SSRF shapes (loopback, RFC1918, link-local metadata endpoints) at registration; it is
 * a tripwire, not a proxy-grade egress policy.
 */
function isPrivateV4(host: string): boolean {
	const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!v4) return false;
	const [a, b] = [Number(v4[1]), Number(v4[2])];
	if (a === 127 || a === 10 || a === 0) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 169 && b === 254) return true;
	return false;
}

function isForbiddenCloudHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
	// IPv6 literals arrive bracketed from WHATWG URL parsing. Codex found the bypass here:
	// only 2000::/3 is global unicast, so everything else (loopback, fe80 link-local, fc/fd
	// ULA, ::ffff: v4-mapped smuggling a private v4) is refused rather than enumerated.
	if (host.includes(':')) {
		const bare = host.replace(/^\[|\]$/g, '');
		const mapped = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
		if (mapped) return isPrivateV4(mapped[1]);
		return !(bare.startsWith('2') || bare.startsWith('3'));
	}
	return isPrivateV4(host);
}

function assertUsableUrl(deps: AppDeps, raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw validationError('The webhook URL is not a valid URL.');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw validationError('The webhook URL must be http(s).');
	}
	if (url.username || url.password) {
		throw validationError('The webhook URL must not carry credentials.');
	}
	// Billing configured is what makes an instance cloud (multi-tenant), where a tenant
	// pointing us at the metadata service or a cluster-internal address is an attack.
	if (deps.config.billing && isForbiddenCloudHost(url.hostname)) {
		throw validationError(
			'That URL points inside a private network. Webhook receivers must be publicly reachable.',
		);
	}
	// The payload carries the buyer's email, so on cloud it crosses networks we do not own
	// and plaintext would put a customer's address in front of every observer on the path.
	// Self-host keeps http on purpose: there the operator owns both ends, the same reason
	// loopback receivers are allowed there.
	if (deps.config.billing && url.protocol !== 'https:') {
		throw validationError(
			"Webhook URLs must use https: the payload carries your customer's email address.",
		);
	}
	return url;
}

/**
 * True when this endpoint would carry the buyer's email over a connection we do not own.
 * Cloud only: on self-host the operator owns both ends of the wire.
 */
function sendsBuyerInClear(deps: AppDeps, endpointUrl: string): boolean {
	if (!deps.config.billing) return false;
	try {
		return new URL(endpointUrl).protocol !== 'https:';
	} catch {
		// An unparseable stored URL cannot be shown to be safe, so withhold the address.
		return true;
	}
}

function assertKnownEvents(events: string[]): asserts events is WebhookEventType[] {
	if (events.length === 0) throw validationError('Subscribe to at least one event type.');
	for (const type of events) {
		if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)) {
			throw validationError(
				`Unknown event type "${type}". Known types: ${WEBHOOK_EVENT_TYPES.join(', ')}.`,
			);
		}
	}
}

export interface CreatedEndpoint {
	id: number;
	url: string;
	events: string[];
	/** Plaintext, returned exactly once at creation or rotation. */
	secret: string;
	/** Slug of the product this endpoint is scoped to, or null for every product. */
	product: string | null;
}

export async function createWebhookEndpoint(
	deps: AppDeps,
	args: {
		accountId: number;
		url: string;
		events: string[];
		/** Resolved by the caller through the account scope, so it is known to be theirs. */
		product?: { id: number; slug: string };
	},
): Promise<CreatedEndpoint> {
	const url = assertUsableUrl(deps, args.url);
	assertKnownEvents(args.events);
	const secret = `cbw_${randomBytes(24).toString('hex')}`;
	const [row] = await deps.db
		.insert(webhookEndpoints)
		.values({
			accountId: args.accountId,
			productId: args.product?.id ?? null,
			url: url.toString(),
			events: JSON.stringify(args.events),
			secret: encryptSecret(secret, deps.config.signingKeySecret),
		})
		.returning();
	if (!row) throw new Error('Endpoint insert reported success but returned no row.');
	return {
		id: row.id,
		url: row.url,
		events: args.events,
		secret,
		product: args.product?.slug ?? null,
	};
}

export async function rotateWebhookSecret(
	deps: AppDeps,
	accountId: number,
	endpointId: number,
): Promise<string | null> {
	const secret = `cbw_${randomBytes(24).toString('hex')}`;
	const rows = await deps.db
		.update(webhookEndpoints)
		.set({ secret: encryptSecret(secret, deps.config.signingKeySecret) })
		.where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.accountId, accountId)))
		.returning({ id: webhookEndpoints.id });
	return rows.length ? secret : null;
}

/** Disable, keeping the row and its delivery history. Returns false for a foreign id. */
export async function disableWebhookEndpoint(
	deps: AppDeps,
	accountId: number,
	endpointId: number,
): Promise<boolean> {
	const rows = await deps.db
		.update(webhookEndpoints)
		.set({ status: 'disabled' })
		.where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.accountId, accountId)))
		.returning({ id: webhookEndpoints.id });
	return rows.length > 0;
}

export async function listWebhookEndpoints(deps: AppDeps, accountId: number) {
	// Left join: an unscoped endpoint has no product row, and it must still be listed. No
	// account condition is needed on the join, because fk_webhook_endpoints_product makes a
	// cross-tenant scope impossible to store in the first place.
	const rows = await deps.db
		.select({ endpoint: webhookEndpoints, productSlug: products.slug })
		.from(webhookEndpoints)
		.leftJoin(products, eq(products.id, webhookEndpoints.productId))
		.where(eq(webhookEndpoints.accountId, accountId))
		.orderBy(webhookEndpoints.id);
	// Never the secret: it was shown once at creation, and that is the whole contract.
	return rows.map(({ endpoint: e, productSlug }) => ({
		id: e.id,
		url: e.url,
		events: JSON.parse(e.events) as string[],
		status: e.status,
		/** Null means every product in the account. */
		product: productSlug ?? null,
		created_at: e.createdAt,
	}));
}

export async function listWebhookDeliveries(deps: AppDeps, accountId: number, endpointId: number) {
	const rows = await deps.db
		.select({ delivery: webhookDeliveries, endpointAccount: webhookEndpoints.accountId })
		.from(webhookDeliveries)
		.innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
		.where(
			and(eq(webhookDeliveries.endpointId, endpointId), eq(webhookEndpoints.accountId, accountId)),
		)
		.orderBy(desc(webhookDeliveries.id))
		.limit(50);
	return rows.map(({ delivery: d }) => ({
		id: d.id,
		event_type: d.eventType,
		status: d.status,
		attempts: d.attempts,
		last_error: d.lastError,
		delivered_at: d.deliveredAt,
		created_at: d.createdAt,
	}));
}

export interface WebhookEventArgs {
	accountId: number;
	type: WebhookEventType;
	license: License;
	product: Product;
	/** Extra event-specific fields merged beside the licence (instance, reason, expiry). */
	detail?: Record<string, unknown>;
}

/**
 * Fan an event out to every subscribed endpoint: one delivery row plus one outbox job
 * each. Best-effort by contract — several call sites are the frozen public path, and a
 * vendor's webhook configuration must never fail a customer's activate.
 */
export async function emitWebhookEvent(deps: AppDeps, args: WebhookEventArgs): Promise<void> {
	try {
		const endpoints = await deps.db
			.select()
			.from(webhookEndpoints)
			.where(
				and(eq(webhookEndpoints.accountId, args.accountId), eq(webhookEndpoints.status, 'active')),
			);
		const subscribed = endpoints.filter(
			(e) =>
				(JSON.parse(e.events) as string[]).includes(args.type) &&
				// A NULL scope means every product in the account, which is what every
				// endpoint created before scoping existed has, so they keep receiving
				// everything. A set scope only hears about its own product.
				(e.productId == null || e.productId === args.product.id),
		);
		if (subscribed.length === 0) return;

		// Only now that something is actually listening. activation.created fires on every
		// activation, so a vendor with no webhooks configured must not pay for this read on
		// the frozen public path.
		//
		// purchase_id is NOT NULL behind a foreign key and purchases.email is NOT NULL, so
		// there is no absent-buyer case to design around. If the row somehow cannot be read
		// anyway, deliver with the field null rather than dropping the event: a consumer that
		// receives nothing is worse off than one that receives a null it will never see.
		const [purchase] = await deps.db
			.select({ email: purchases.email })
			.from(purchases)
			.where(eq(purchases.id, args.license.purchaseId));

		const createdAt = nowDate(deps).toISOString();
		const bodyFor = (endpointUrl: string) =>
			JSON.stringify({
				event: { type: args.type, created_at: createdAt },
				// The §9 licence object exactly as the public API serializes it. The buyer is
				// assembled here and never in that shared serializer, because a field added there
				// would surface on every activate and validate response, which is the drift §9
				// forbids.
				license: serializeLicense(args.license, args.product),
				// Registration refuses plaintext on cloud, but a row predating that rule can
				// still be http. The object always ships so no consumer branches on its absence;
				// the address is what stays behind.
				buyer: { email: sendsBuyerInClear(deps, endpointUrl) ? null : (purchase?.email ?? null) },
				...(args.detail ?? {}),
			});
		for (const endpoint of subscribed) {
			// One transaction per delivery: a row without its outbox job would sit 'pending'
			// forever, since the drain only ever claims jobs (Codex, #108 review).
			await deps.db.transaction(async (tx) => {
				const scoped = withTx(deps, tx as AppDeps['db']);
				const [row] = await scoped.db
					.insert(webhookDeliveries)
					.values({ endpointId: endpoint.id, eventType: args.type, payload: bodyFor(endpoint.url) })
					.returning({ id: webhookDeliveries.id });
				if (row) await enqueue(scoped, 'deliver_webhook', { deliveryId: row.id });
			});
		}
	} catch (err) {
		deps.logger.error('Webhook emit failed; the triggering call still succeeds', {
			type: args.type,
			error: String(err),
		});
	}
}

/** The signature header value for a body: verifiable as HMAC-SHA256(secret, `${t}.${body}`). */
export function signWebhookBody(secret: string, timestampSeconds: number, body: string): string {
	const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
	return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Receiver-side check, exported for the docs snippet and the contract tests: recompute
 * and compare in constant time, refusing stale timestamps.
 */
export function verifyWebhookSignature(
	secret: string,
	header: string,
	body: string,
	nowSeconds: number,
	toleranceSeconds = 300,
): boolean {
	const t = Number(header.match(/t=(\d+)/)?.[1]);
	const v1 = header.match(/v1=([0-9a-f]+)/)?.[1];
	if (!Number.isFinite(t) || !v1) return false;
	if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
	const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	const a = Buffer.from(v1, 'hex');
	const b = Buffer.from(expected, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deliver one row. Called by the outbox job handler; throwing is how a retry is asked
 * for, and the delivery row mirrors the trail so the console reads one place.
 */
export async function deliverWebhook(deps: AppDeps, deliveryId: number): Promise<void> {
	const [found] = await deps.db
		.select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
		.from(webhookDeliveries)
		.innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
		.where(eq(webhookDeliveries.id, deliveryId))
		.limit(1);
	if (!found) return;
	const { delivery, endpoint } = found;
	if (delivery.status === 'delivered') return; // idempotent re-run
	if (endpoint.status !== 'active') {
		await deps.db
			.update(webhookDeliveries)
			.set({ status: 'failed', lastError: 'Endpoint disabled before delivery.' })
			.where(eq(webhookDeliveries.id, deliveryId));
		return;
	}
	const secret = decryptSecret(endpoint.secret, deps.config.signingKeySecret);
	const timestamp = Math.floor(nowDate(deps).getTime() / 1000);
	try {
		const res = await fetch(endpoint.url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'coolbeans-webhooks',
				'X-CoolBeans-Event': delivery.eventType,
				'X-CoolBeans-Signature': signWebhookBody(secret, timestamp, delivery.payload),
			},
			body: delivery.payload,
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`Receiver answered HTTP ${res.status}`);
		await deps.db
			.update(webhookDeliveries)
			.set({ status: 'delivered', deliveredAt: nowDate(deps).toISOString() })
			.where(eq(webhookDeliveries.id, deliveryId));
	} catch (err) {
		const message = String(err instanceof Error ? err.message : err).slice(0, 500);
		const attempts = delivery.attempts + 1;
		await deps.db
			.update(webhookDeliveries)
			.set({
				attempts: sql`${webhookDeliveries.attempts} + 1`,
				lastError: message,
				// Mirror the outbox's give-up threshold so the log tells the truth about
				// whether anything will try again.
				...(attempts >= DELIVERY_MAX_ATTEMPTS ? { status: 'failed' as const } : {}),
			})
			.where(eq(webhookDeliveries.id, deliveryId));
		throw err;
	}
}

export type { WebhookEndpoint };
