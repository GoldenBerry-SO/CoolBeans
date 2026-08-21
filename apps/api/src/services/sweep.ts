// ABOUTME: Periodic sweeps (PRD §17) — disable expired trials and reap dead floating leases.
// ABOUTME: Trial expiry is enforced lazily at validate too; the sweep keeps state consistent offline.

import { activations, affected, licenses, products } from '@coolbeans/db';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { pruneProviderEvents, pruneWebhookDeliveries } from './prune.js';
import { pruneConnectStates } from './stripe-onboarding.js';
import { emitWebhookEvent } from './webhooks-out.js';

/** Disable every active trial whose expires_at has passed. Returns the count disabled. */
export async function sweepExpiredTrials(deps: AppDeps): Promise<number> {
	const nowIso = nowDate(deps).toISOString();
	// The sweep runs instance-wide, so the account comes from each licence's product —
	// audit rows are account-scoped and a row filed elsewhere is invisible to its vendor.
	const due = await deps.db
		.select({ license: licenses, product: products })
		.from(licenses)
		.innerJoin(products, eq(products.id, licenses.productId))
		.where(
			and(
				eq(licenses.kind, 'trial'),
				eq(licenses.status, 'active'),
				isNotNull(licenses.expiresAt),
				lte(licenses.expiresAt, nowIso),
			),
		);
	for (const { license, product } of due) {
		await deps.db
			.update(licenses)
			.set({ status: 'disabled', disabledAt: nowIso, disabledReason: 'trial_expired' })
			.where(eq(licenses.id, license.id));
		await writeAudit(deps.db, {
			action: 'license.disabled',
			actor: 'system',
			accountId: product.accountId,
			productId: license.productId,
			licenseId: license.id,
			detail: { reason: 'trial_expired', swept: true },
		});
		await emitWebhookEvent(deps, {
			accountId: product.accountId,
			type: 'license.disabled',
			license: {
				...license,
				status: 'disabled',
				disabledAt: nowIso,
				disabledReason: 'trial_expired',
			},
			product,
			detail: { reason: 'trial_expired' },
		});
	}
	return due.length;
}

/** Mark expired floating leases deactivated so seat counts and listings stay tidy. */
export async function reapFloatingLeases(deps: AppDeps): Promise<number> {
	const nowIso = nowDate(deps).toISOString();
	const result = await deps.db
		.update(activations)
		.set({ deactivatedAt: nowIso })
		.where(
			and(
				sql`${activations.deactivatedAt} IS NULL`,
				isNotNull(activations.leaseExpiresAt),
				lte(activations.leaseExpiresAt, nowIso),
				sql`${activations.licenseId} IN (SELECT id FROM licenses WHERE product_id IN (SELECT id FROM ${products} WHERE activation_model = 'floating'))`,
			),
		)
		.returning({
			id: activations.id,
			licenseId: activations.licenseId,
			instanceId: activations.instanceId,
		});
	const freed = affected(result);
	// §16 says every state change is auditable; an automated seat release is a state
	// change even though no human asked for it. One row per account touched, since the
	// audit feed is account-scoped and one instance-wide row would be visible to nobody
	// but the default account.
	if (freed > 0) {
		const owners = await deps.db
			.select({ license: licenses, product: products })
			.from(licenses)
			.innerJoin(products, eq(products.id, licenses.productId))
			.where(
				inArray(
					licenses.id,
					result.map((r) => r.licenseId),
				),
			);
		const ownerOf = new Map(owners.map((o) => [o.license.id, o]));
		const perAccount = new Map<number, number>();
		for (const row of result) {
			const owner = ownerOf.get(row.licenseId);
			if (!owner) continue;
			perAccount.set(owner.product.accountId, (perAccount.get(owner.product.accountId) ?? 0) + 1);
			// A reaped lease frees a seat exactly as a manual deactivate does, so subscribers
			// to activation.deactivated hear about it the same way (Codex, #108 review).
			await emitWebhookEvent(deps, {
				accountId: owner.product.accountId,
				type: 'activation.deactivated',
				license: owner.license,
				product: owner.product,
				detail: { instance: { id: row.instanceId }, reason: 'lease_expired' },
			});
		}
		for (const [accountId, seats] of perAccount) {
			await writeAudit(deps.db, {
				action: 'lease.reaped',
				actor: 'system',
				accountId,
				detail: { seats_freed: seats },
			});
		}
	}
	return freed;
}

/** Run all periodic sweeps. Scheduled by the worker (BullMQ repeatable) in production. */
export async function runSweeps(
	deps: AppDeps,
): Promise<{ trials: number; leases: number; pruned: number }> {
	return {
		trials: await sweepExpiredTrials(deps),
		leases: await reapFloatingLeases(deps),
		// Provider events, abandoned Connect authorization states and finished webhook
		// deliveries are all "rows that were only ever needed briefly". A vendor who opens
		// the Stripe screens and wanders off leaves a state behind, so without this the
		// table only grows. Deliveries also carry the buyer's email in their stored payload,
		// which is a second reason not to keep them forever.
		pruned:
			(await pruneProviderEvents(deps)) +
			(await pruneConnectStates(deps)) +
			(await pruneWebhookDeliveries(deps)),
	};
}
