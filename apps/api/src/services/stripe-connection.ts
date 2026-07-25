// ABOUTME: Stripe Connect lifecycle (issue #62 cloud) — bind a connected account, or tear it down.
// ABOUTME: One vendor Stripe account maps to one connection; its events route by event.account.

import type { StripeConnection } from '@coolbeans/db';
import { licenseGrants, stripeConnections } from '@coolbeans/db';
import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { getConnectionByStripeAccount } from '../store/grants.js';
import type { StripeGateway } from './stripe-gateway.js';

/**
 * The gateway that reads a connection's OWN Stripe account.
 *
 * A price id only means anything inside the account that owns it, so a cloud vendor's price
 * must be looked up through the platform Connect credential scoped to their connected account
 * (Stripe-Account). Asking the platform account instead answers "no such price" for every
 * price a vendor has, which reads as a typo and leaves them unable to sell anything.
 */
export function gatewayForConnection(deps: AppDeps, connection: StripeConnection): StripeGateway {
	if (connection.mode === 'cloud_connect') {
		if (!deps.connect) throw new Error('Stripe Connect is not configured on this server.');
		return deps.connect.forAccount(connection.stripeAccountId);
	}
	if (!deps.stripe) throw new Error('Stripe is not configured on this server.');
	return deps.stripe;
}

/**
 * Record a vendor's authorized Stripe Connect account as a connection. Upsert by
 * stripe_account_id (unique), so re-authorizing reactivates the same connection rather than
 * duplicating it. The account that owns it never changes on re-auth: a Stripe account belongs
 * to exactly one Cool Beans tenant.
 */
export async function createCloudConnection(
	deps: AppDeps,
	args: { accountId: number; stripeAccountId: string; livemode?: boolean; actor: string },
): Promise<StripeConnection> {
	const [connection] = await deps.db
		.insert(stripeConnections)
		.values({
			accountId: args.accountId,
			provider: 'stripe',
			mode: 'cloud_connect',
			stripeAccountId: args.stripeAccountId,
			livemode: args.livemode ?? false,
			status: 'active',
		})
		.onConflictDoUpdate({
			target: stripeConnections.stripeAccountId,
			set: { status: 'active', livemode: args.livemode ?? false },
		})
		.returning();
	await writeAudit(deps.db, {
		action: 'stripe.connection_authorized',
		actor: args.actor,
		accountId: args.accountId,
		detail: { stripe_account: args.stripeAccountId, mode: 'cloud_connect' },
	});
	return connection;
}

/**
 * A vendor disconnected (account.application.deauthorized): retire every grant on the
 * connection so no more keys issue, and mark the connection disconnected. Issued licences are
 * untouched (§9): a key already sold keeps validating.
 */
export async function disconnectConnection(
	deps: AppDeps,
	args: { stripeAccountId: string; actor: string },
): Promise<void> {
	const connection = await getConnectionByStripeAccount(deps.db, args.stripeAccountId);
	if (!connection) return;
	const retiredAt = nowDate(deps).toISOString();
	await deps.db
		.update(licenseGrants)
		.set({ status: 'retired', retiredAt })
		.where(
			and(eq(licenseGrants.stripeConnectionId, connection.id), eq(licenseGrants.status, 'active')),
		);
	await deps.db
		.update(stripeConnections)
		.set({ status: 'disconnected' })
		.where(eq(stripeConnections.id, connection.id));
	await writeAudit(deps.db, {
		action: 'stripe.connection_disconnected',
		actor: args.actor,
		accountId: connection.accountId,
		detail: { stripe_account: args.stripeAccountId },
	});
}
