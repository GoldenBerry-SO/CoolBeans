// ABOUTME: Email wiring (PRD §14) — resolve the configured sender and send the key-delivery email.
// ABOUTME: Missing config degrades gracefully (email disabled); issuance still works.

import type { License, Product } from '@coolbeans/db';
import { licenses } from '@coolbeans/db';
import {
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

/** Build an EmailSender from config, or undefined when no provider is set. */
export function resolveEmailSender(config: Config, logger: Logger): EmailSender | undefined {
	if (!config.email) {
		logger.info('Email disabled: no EMAIL_PROVIDER configured');
		return undefined;
	}
	if (config.email.provider === 'resend') return createResendSender(config.email.apiKey);
	return createSmtpSender({
		host: config.email.host,
		port: config.email.port,
		user: config.email.user,
		pass: config.email.pass,
	});
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
	const isYearly = args.license.tier === 'yearly';
	const html = await render(
		LicenseKeyEmail({
			productName: args.product.name,
			licenseKey: displayKey,
			downloadUrl: args.product.downloadUrl ?? undefined,
			renewalDate:
				isYearly && args.license.expiresAt ? args.license.expiresAt.slice(0, 10) : undefined,
			portalUrl: isYearly ? `${deps.config.publicUrl}/portal` : undefined,
		}),
	);
	await deps.email.send({
		from: args.product.emailFrom,
		to: args.email,
		subject: `Your ${args.product.name} license key`,
		html,
	});
	deps.db
		.update(licenses)
		.set({ emailSentAt: nowIso(deps) })
		.where(eq(licenses.id, args.license.id))
		.run();
	return true;
}
