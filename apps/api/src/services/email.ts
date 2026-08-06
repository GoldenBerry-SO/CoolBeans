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
import { getProductIcon } from './product-icons.js';

/** The Content-ID the licence email's <img> references as `cid:`. Arbitrary but stable. */
const PRODUCT_ICON_CID = 'product-icon';

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

/** The addr-spec out of either `Name <a@b>` or a bare `a@b`. */
function addressOf(sender: string): string {
	const angle = sender.match(/<([^>]*)>\s*$/);
	return (angle ? angle[1] : sender).trim();
}

/**
 * A display name safe to drop in a From header. Newlines would let a product name inject
 * extra headers, and an unescaped quote or comma would truncate the name at best and
 * corrupt the header at worst, so the name is always escaped and always quoted.
 */
function quoteDisplayName(name: string): string {
	const flat = name.replace(/[\r\n]+/g, ' ').trim();
	return `"${flat.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

/**
 * Put the product's name on the From line, keeping whatever address the identity resolved to.
 *
 * A buyer's inbox showed `no-reply@coolbeans.tools` and nothing else, which tells them
 * nothing about what they just bought and looks like a stranger's mail. The address has to
 * stay on our verified domain or Resend refuses to send, but the display name is free text,
 * so the buyer can see "TideGlass" while DKIM still signs for coolbeans.tools.
 *
 * Any display name already on the sender is replaced rather than kept: the configured one is
 * "Cool Beans", which is precisely the wrong answer for a buyer who bought someone's app.
 */
export function senderWithProductName(from: string, productName: string): string {
	return `${quoteDisplayName(productName)} <${addressOf(from)}>`;
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
	/**
	 * The vendor's own logo fronts the email when they uploaded one (#115) — the licence
	 * email is their brand moment, not ours.
	 *
	 * Sent as an inline attachment, not a hosted URL. A URL only renders for readers whose
	 * client loads remote images, and most block them by default, so the hosted version was
	 * visible in Gmail (which proxies) and invisible in Apple Mail and Outlook. Bytes in the
	 * message have nothing to fetch. No icon means no image at all rather than falling back
	 * to our bean: the Cool Beans mark beside a "TideGlass" wordmark reads as the wrong
	 * company, and the wordmark alone is honest.
	 */
	const icon = await getProductIcon(deps, args.product.id);
	const html = await render(
		LicenseKeyEmail({
			productName: args.product.name,
			licenseKey: displayKey,
			downloadUrl: args.product.downloadUrl ?? undefined,
			renewalDate:
				isSubscription && args.license.expiresAt ? args.license.expiresAt.slice(0, 10) : undefined,
			portalUrl: isSubscription ? `${deps.config.publicUrl}/portal` : undefined,
			logoSrc: icon ? `cid:${PRODUCT_ICON_CID}` : undefined,
		}),
	);
	const identity = resolveEmailIdentity(deps.config, args.product.emailFrom);
	await deps.email.send({
		...identity,
		from: senderWithProductName(identity.from, args.product.name),
		to: args.email,
		subject: `Your ${args.product.name} license key`,
		html,
		...(icon
			? {
					attachments: [
						{
							filename: `icon.${icon.mime === 'image/png' ? 'png' : icon.mime === 'image/webp' ? 'webp' : 'jpg'}`,
							content: icon.bytes,
							contentType: icon.mime,
							contentId: PRODUCT_ICON_CID,
						},
					],
				}
			: {}),
	});
	await deps.db
		.update(licenses)
		.set({ emailSentAt: nowIso(deps) })
		.where(eq(licenses.id, args.license.id));
	return true;
}
