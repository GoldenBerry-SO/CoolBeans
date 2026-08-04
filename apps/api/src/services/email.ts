// ABOUTME: Email wiring (PRD §14) — resolve the configured sender and send the key-delivery email.
// ABOUTME: Missing config degrades gracefully (email disabled); issuance still works.

import type { License, Product } from '@coolbeans/db';
import { licenses } from '@coolbeans/db';
import {
	createConsoleSender,
	createResendSender,
	createSmtpSender,
	type EmailSender,
	LicenseKeyEmail,
	render,
} from '@coolbeans/email';
import type { Logger } from '@coolbeans/logger';
import { eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { AppDeps } from '../deps.js';
import { nowIso } from '../deps.js';
import { toDisplayKey } from '../domain/keygen.js';
import { hasProductIcon } from './product-icons.js';

/** Build an EmailSender from config, or undefined when no provider is set. */
export function resolveEmailSender(config: Config, logger: Logger): EmailSender | undefined {
	if (!config.email) {
		logger.info('Email disabled: no EMAIL_PROVIDER configured');
		return undefined;
	}
	if (config.email.provider === 'console') {
		logger.warn('Email provider is "console": emails are logged, not delivered');
		return createConsoleSender((email) => {
			// One structured line per email, so local work and the journey suite can both
			// see exactly what a customer would have received.
			logger.info('email.sent', {
				from: email.from,
				to: email.to,
				subject: email.subject,
				html: email.html,
			});
		});
	}
	if (config.email.provider === 'resend') {
		return createResendSender(config.email.apiKey, config.email.baseUrl);
	}
	return createSmtpSender({
		host: config.email.host,
		port: config.email.port,
		user: config.email.user,
		pass: config.email.pass,
	});
}

/**
 * The verified fallback sender when a cloud instance sets no EMAIL_SENDER. Our cloud
 * verifies the coolbeans.tools domain, so any address on it sends. Deploys should set
 * EMAIL_SENDER explicitly; this only stops a missing value from silently using a
 * customer's unverified domain.
 */
const CLOUD_FALLBACK_SENDER = 'Cool Beans <no-reply@coolbeans.tools>';

/**
 * Who a vendor-facing email (key delivery, key recovery) is from, and where replies go.
 *
 * On cloud we cannot send from a customer's own domain: Resend only sends from a domain
 * verified in our account, so a product's `email_from` of `receipts@theirdomain.com` would
 * be rejected and the buyer would never get their key. So on cloud we send from our
 * verified sender and put the customer's address in Reply-To, which still reaches them.
 * On self-host (no billing) the operator verifies their own domain, so the per-product
 * `email_from` is honoured directly, as before.
 */
export function resolveEmailIdentity(
	config: Pick<Config, 'billing' | 'emailSender'>,
	productEmailFrom: string,
): { from: string; replyTo?: string } {
	if (config.billing) {
		return { from: config.emailSender ?? CLOUD_FALLBACK_SENDER, replyTo: productEmailFrom };
	}
	return { from: productEmailFrom };
}

/**
 * Send the key-delivery email for a license and stamp email_sent_at on success.
 * Throws on failure so the caller can leave email_sent_at NULL for a retry (PRD §13).
 */
export async function sendKeyEmail(
	deps: AppDeps,
	args: { license: License; product: Product; email: string },
): Promise<boolean> {
	if (!deps.email) return false;
	const displayKey = toDisplayKey(args.license.key, args.product.keyPrefix);
	const isSubscription = args.license.kind === 'subscription';
	// The vendor's own logo fronts the email when they uploaded one (#115) — the licence
	// email is their brand moment, not ours. Existence check only; the blob never loads.
	const logoUrl = (await hasProductIcon(deps, args.product.id))
		? `${deps.config.publicUrl}/v1/products/${args.product.slug}/icon`
		: `${deps.config.publicUrl}/logo.png`;
	const html = await render(
		LicenseKeyEmail({
			productName: args.product.name,
			licenseKey: displayKey,
			downloadUrl: args.product.downloadUrl ?? undefined,
			renewalDate:
				isSubscription && args.license.expiresAt ? args.license.expiresAt.slice(0, 10) : undefined,
			portalUrl: isSubscription ? `${deps.config.publicUrl}/portal` : undefined,
			logoUrl,
		}),
	);
	await deps.email.send({
		...resolveEmailIdentity(deps.config, args.product.emailFrom),
		to: args.email,
		subject: `Your ${args.product.name} license key`,
		html,
	});
	await deps.db
		.update(licenses)
		.set({ emailSentAt: nowIso(deps) })
		.where(eq(licenses.id, args.license.id));
	return true;
}
