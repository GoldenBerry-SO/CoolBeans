// ABOUTME: Email sender adapters (PRD §14) — Resend for the cloud, SMTP for self-host.
// ABOUTME: Both implement EmailSender; selection happens in the API from EMAIL_PROVIDER config.

import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { EmailSender, OutgoingEmail } from './index.js';

/**
 * Resend adapter — a single API call, works anywhere fetch does. baseUrl points the
 * client at a local stand-in for journey tests; unset in production.
 */
export function createResendSender(apiKey: string, baseUrl?: string): EmailSender {
	const resend = new Resend(apiKey, baseUrl ? { baseUrl } : undefined);
	return {
		async send(email: OutgoingEmail): Promise<void> {
			const { error } = await resend.emails.send({
				from: email.from,
				to: email.to,
				subject: email.subject,
				html: email.html,
			});
			if (error) throw new Error(`Resend failed: ${error.message}`);
		},
	};
}

/**
 * Development sender: hands the rendered email to a sink (the logger) instead of
 * delivering it. Local work then needs no mail provider at all, and every email the
 * system would have sent is visible and assertable.
 */
export function createConsoleSender(sink: (email: OutgoingEmail) => void): EmailSender {
	return {
		async send(email: OutgoingEmail): Promise<void> {
			sink(email);
		},
	};
}

export interface SmtpOptions {
	host: string;
	port: number;
	user?: string;
	pass?: string;
}

/** SMTP adapter for self-hosters. */
export function createSmtpSender(opts: SmtpOptions): EmailSender {
	const transport = nodemailer.createTransport({
		host: opts.host,
		port: opts.port,
		secure: opts.port === 465,
		auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
	});
	return {
		async send(email: OutgoingEmail): Promise<void> {
			await transport.sendMail({
				from: email.from,
				to: email.to,
				subject: email.subject,
				html: email.html,
			});
		},
	};
}
