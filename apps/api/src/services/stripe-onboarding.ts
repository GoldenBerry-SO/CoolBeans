// ABOUTME: The Stripe Connect authorization handshake (issue #62 cloud) — start it, then finish it.
// ABOUTME: The state is single use and bound to one account, so a callback cannot bind somebody else's Stripe.

import { createHash, randomBytes } from 'node:crypto';
import type { StripeConnection } from '@coolbeans/db';
import { applied, rowsOf, stripeConnectStates } from '@coolbeans/db';
import { and, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { badRequest } from '../http/errors.js';
import { createCloudConnection } from './stripe-connection.js';

/** How long a vendor has to finish the Stripe screens before the state goes stale. */
const STATE_TTL_MS = 15 * 60_000;

/** The state travels through Stripe and back, so only its hash is stored (§19). */
function hashState(state: string): string {
	return createHash('sha256').update(state).digest('hex');
}

/**
 * Join a path onto PUBLIC_URL, keeping whatever prefix it carries and never doubling a slash.
 *
 * Both halves matter, because Stripe matches redirect_uri EXACTLY against the values
 * registered on the Connect application. PUBLIC_URL is taken from the environment as written,
 * so a trailing slash would give `https://host//v1/...`; and `new URL('/v1/...', base)` is not
 * the fix, because a leading-slash path REPLACES the base's own path, silently dropping the
 * prefix of an instance served under one (`https://host/coolbeans` becomes `https://host`).
 * Either way onboarding fails for a reason nobody would guess from the error, so trim the
 * trailing slashes and concatenate.
 */
export function publicUrlFor(deps: AppDeps, path: string): string {
	return `${deps.config.publicUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Begin authorization: mint a one-shot state bound to this account and build the Stripe URL
 * to send the vendor to. Nothing is connected until they come back through the callback.
 */
export async function startConnectAuthorization(
	deps: AppDeps,
	args: { accountId: number },
): Promise<{ url: string; state: string }> {
	const connect = deps.config.connect;
	if (!connect?.clientId) {
		throw badRequest('Stripe Connect is not configured on this server.');
	}
	const state = randomBytes(32).toString('base64url');
	const now = nowDate(deps);
	await deps.db.insert(stripeConnectStates).values({
		accountId: args.accountId,
		stateHash: hashState(state),
		expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
	});
	const url = new URL('https://connect.stripe.com/oauth/authorize');
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', connect.clientId);
	// read_write so the platform can read prices and register nothing on their behalf beyond
	// what the licensing flow needs. We never move money: no application fee, no transfers.
	url.searchParams.set('scope', 'read_write');
	url.searchParams.set('state', state);
	url.searchParams.set('redirect_uri', publicUrlFor(deps, '/v1/connect/stripe/callback'));
	return { url: url.toString(), state };
}

/**
 * Finish authorization: spend the state, redeem the code, and record the connection.
 *
 * The state is what stops a cross-account bind. Without it a callback is just a URL anyone
 * can replay with their own code, which would attach an attacker's Stripe account to whatever
 * tenant the link was aimed at. It is consumed with a guarded UPDATE, so two concurrent
 * callbacks cannot both spend it.
 */
export async function completeConnectAuthorization(
	deps: AppDeps,
	args: { code: string; state: string },
): Promise<StripeConnection> {
	if (!deps.connect) throw badRequest('Stripe Connect is not configured on this server.');
	const nowIso = nowDate(deps).toISOString();
	// Single statement: match an unspent, unexpired state and claim it in the same breath.
	const claimed = await deps.db.execute(sql`
		UPDATE stripe_connect_states
		SET consumed_at = ${nowIso}
		WHERE state_hash = ${hashState(args.state)}
			AND consumed_at IS NULL
			AND expires_at > ${nowIso}
		RETURNING account_id
	`);
	if (!applied(claimed)) {
		// Unknown, already spent, or stale. All three are "this callback proves nothing".
		throw badRequest('That Stripe authorization link is no longer valid. Start again.');
	}
	// rowsOf, not a hand-rolled shape check: a raw execute is an array on postgres-js and an
	// object on PGlite, and reading the wrong one is a 500 that only shows up on one driver.
	const accountId = rowsOf<{ account_id: number }>(claimed)[0]?.account_id;
	if (accountId === undefined) throw new Error('Claimed a connect state with no account id.');

	const account = await deps.connect.exchangeConnectCode(args.code);
	if (!account) {
		throw badRequest('Stripe would not confirm that authorization. Start again.');
	}
	return await createCloudConnection(deps, {
		accountId,
		stripeAccountId: account.stripeAccountId,
		livemode: account.livemode,
		actor: `connect:${account.stripeAccountId}`,
	});
}

/**
 * Drop states that expired without being used, so the table does not grow without bound.
 * Spent ones stay: they are the record that an authorization actually happened. Returns how
 * many went, so the sweep can report it.
 */
export async function pruneConnectStates(deps: AppDeps): Promise<number> {
	const gone = await deps.db
		.delete(stripeConnectStates)
		.where(
			and(
				isNull(stripeConnectStates.consumedAt),
				sql`${stripeConnectStates.expiresAt} < ${nowDate(deps).toISOString()}`,
			),
		)
		.returning({ id: stripeConnectStates.id });
	return gone.length;
}

export { hashState as connectStateHash };
