// ABOUTME: Public entry for @coolbeans/email — templates, render helper, and the sender seam.
// ABOUTME: Senders (Resend for the cloud, SMTP for self-host) implement the EmailSender interface.

export { render } from '@react-email/render';
export {
	createConsoleSender,
	createResendSender,
	createSmtpSender,
	type SmtpOptions,
} from './senders.js';
export { KeyRecoveryEmail, type KeyRecoveryEmailProps } from './templates/key-recovery.js';
export { LicenseKeyEmail, type LicenseKeyEmailProps } from './templates/license-key.js';
export { MagicCodeEmail, type MagicCodeEmailProps } from './templates/magic-code.js';

/**
 * A file travelling with the message. Set `contentId` and the file is sent inline, so the
 * HTML can reference it as `cid:<contentId>` instead of an https URL.
 *
 * This is how a logo actually reaches a reader. Most clients (Apple Mail with privacy
 * protection, Outlook, Thunderbird) block remote images by default, so a hosted <img> shows
 * nothing until the reader clicks "load images" — Gmail is the outlier that proxies and
 * loads them for you, which is why a remote logo can look fine in testing and be invisible
 * everywhere else. An inline part is already in the message, so there is nothing to fetch
 * and nothing to block.
 */
export interface EmailAttachment {
	filename: string;
	content: Buffer;
	contentType?: string;
	/** Present means inline; absent means a normal attachment. */
	contentId?: string;
}

export interface OutgoingEmail {
	from: string;
	to: string;
	subject: string;
	html: string;
	/** Where replies go. On cloud this carries the vendor's address while `from` is ours. */
	replyTo?: string;
	attachments?: EmailAttachment[];
}

// The Resend and SMTP adapters land with the email-delivery issue; both implement this.
export interface EmailSender {
	send(email: OutgoingEmail): Promise<void>;
}
