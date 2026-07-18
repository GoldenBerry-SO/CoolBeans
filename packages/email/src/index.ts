// ABOUTME: Public entry for @coolbeans/email — templates, render helper, and the sender seam.
// ABOUTME: Senders (Resend for the cloud, SMTP for self-host) implement the EmailSender interface.

export { render } from '@react-email/render';
export { createResendSender, createSmtpSender, type SmtpOptions } from './senders.js';
export { LicenseKeyEmail, type LicenseKeyEmailProps } from './templates/license-key.js';

export interface OutgoingEmail {
	from: string;
	to: string;
	subject: string;
	html: string;
}

// The Resend and SMTP adapters land with the email-delivery issue; both implement this.
export interface EmailSender {
	send(email: OutgoingEmail): Promise<void>;
}
