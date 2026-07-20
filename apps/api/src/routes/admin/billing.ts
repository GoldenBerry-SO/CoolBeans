// ABOUTME: The account's own plan and billing controls — status, checkout, and the Stripe portal.
// ABOUTME: Never product-scoped: a cbp_ token must not open a checkout session for a whole account.

import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppDeps } from '../../deps.js';
import { conflict } from '../../http/errors.js';
import {
	ensureSubscriptionRow,
	getSubscriptionRow,
	setCustomerId,
} from '../../services/billing.js';
import { isBillingEnabled, planUsage } from '../../services/plan-limits.js';
import { accountScope, adminEmail } from './util.js';

export function registerAdminBillingRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/billing', async (c) => {
		const account = accountScope(c);
		const enabled = isBillingEnabled(deps);
		const row = enabled ? await getSubscriptionRow(deps, account.id) : undefined;
		const usage = await planUsage(deps, account);
		return c.json({
			ok: true,
			billing: {
				// The console hides the whole page when this is false. A self-hoster must
				// never be shown an upgrade button for something PRD §7 says they own.
				enabled,
				plan: account.plan,
				status: row?.status ?? null,
				current_period_end: row?.currentPeriodEnd ?? null,
				cancel_at_period_end: row?.cancelAtPeriodEnd ?? false,
				past_due_since: row?.pastDueSince ?? null,
				over_limit_since: account.overLimitSince,
				usage: {
					products: usage.products,
					active_licenses: usage.activeLicenses,
				},
			},
		});
	});

	admin.post('/billing/checkout', async (c) => {
		const account = accountScope(c);
		if (!deps.billing || !deps.config.billing) {
			throw conflict('billing_not_configured', 'Billing is not configured on this server.');
		}
		const row = await ensureSubscriptionRow(deps, account.id);

		// Already subscribed. Send them to the portal instead of opening a second
		// subscription, which is what a stale tab left open would otherwise do.
		if (account.plan === 'pro' && row.stripeCustomerId && row.stripeSubscriptionId) {
			const url = await deps.billing.billingPortalSession(
				row.stripeCustomerId,
				`${deps.config.publicUrl}/billing`,
			);
			return c.json({ ok: true, url, already_subscribed: true });
		}

		let customerId = row.stripeCustomerId;
		if (!customerId) {
			// Stripe sends receipts and, more importantly, card-failure notices to this
			// address. Registering a placeholder would create a subscription whose owner
			// never hears that their payment is failing — the dunning blind spot the
			// invoice.payment_failed handler exists to close. Refuse instead.
			const email = adminEmail(c);
			if (!email) {
				throw conflict(
					'no_billing_contact',
					'Checkout needs a signed-in admin, because Stripe sends payment-failure notices to their address. Sign in to the console rather than using an instance token.',
				);
			}
			customerId = await deps.billing.createCustomer({
				email,
				accountId: account.id,
				name: account.name,
			});
			// Persist before creating the session, so a checkout that falls over leaves a
			// reusable customer rather than an orphan we create again next time.
			await setCustomerId(deps, account.id, customerId);
		}

		const url = await deps.billing.createCheckoutSession({
			customerId,
			priceId: deps.config.billing.proPriceId,
			successUrl: `${deps.config.publicUrl}/billing?upgraded=1`,
			cancelUrl: `${deps.config.publicUrl}/billing?canceled=1`,
			accountId: account.id,
		});
		return c.json({ ok: true, url });
	});

	admin.post('/billing/portal', async (c) => {
		const account = accountScope(c);
		if (!deps.billing) {
			throw conflict('billing_not_configured', 'Billing is not configured on this server.');
		}
		const row = await getSubscriptionRow(deps, account.id);
		if (!row?.stripeCustomerId) {
			throw conflict(
				'no_billing_account',
				'This account has never been to checkout, so there is nothing to manage yet.',
			);
		}
		const url = await deps.billing.billingPortalSession(
			row.stripeCustomerId,
			`${deps.config.publicUrl}/billing`,
		);
		return c.json({ ok: true, url });
	});
}
