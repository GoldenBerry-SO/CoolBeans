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

export interface OutgoingEmail {
	from: string;
	to: string;
	subject: string;
	html: string;
	/** Where replies go. On cloud this carries the vendor's address while `from` is ours. */
	replyTo?: string;
}

// The Resend and SMTP adapters land with the email-delivery issue; both implement this.
export interface EmailSender {
	send(email: OutgoingEmail): Promise<void>;
}
