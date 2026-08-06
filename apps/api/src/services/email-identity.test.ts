// ABOUTME: resolveEmailIdentity — cloud sends from a verified address, self-host keeps custom.
// ABOUTME: The bug it fixes: a customer's email_from is rejected by Resend on cloud (unverified).

import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { resolveEmailIdentity, senderWithProductName } from './email.js';

const billing: Config['billing'] = {
	stripeSecretKey: 'sk_test',
	proPriceId: 'price_test',
};

describe('resolveEmailIdentity', () => {
	it('self-host sends from the product address, no reply-to', () => {
		// No billing configured is self-host: the operator verified their own domain.
		const id = resolveEmailIdentity({ billing: undefined }, 'receipts@theirdomain.com');
		expect(id.from).toBe('receipts@theirdomain.com');
		expect(id.replyTo).toBeUndefined();
	});

	it('cloud sends from EMAIL_SENDER and replies go to the vendor', () => {
		const id = resolveEmailIdentity(
			{ billing, emailSender: 'Cool Beans <keys@coolbeans.tools>' },
			'receipts@theirdomain.com',
		);
		expect(id.from).toBe('Cool Beans <keys@coolbeans.tools>');
		// The vendor's own address is never dropped — it just moves to reply-to.
		expect(id.replyTo).toBe('receipts@theirdomain.com');
	});

	it('cloud without EMAIL_SENDER falls back to a verified address, never the customer domain', () => {
		// The whole point: on cloud we must not put an unverified customer domain in `from`,
		// even when the operator forgot to set EMAIL_SENDER.
		const id = resolveEmailIdentity({ billing }, 'receipts@theirdomain.com');
		expect(id.from).not.toContain('theirdomain.com');
		expect(id.from).toContain('coolbeans.tools');
		expect(id.replyTo).toBe('receipts@theirdomain.com');
	});
});

describe('senderWithProductName', () => {
	it('puts the product name on a bare address', () => {
		// What the buyer saw before this existed: "no-reply@coolbeans.tools" and nothing else,
		// which says nothing about what they bought.
		expect(senderWithProductName('no-reply@coolbeans.tools', 'TideGlass')).toBe(
			'"TideGlass" <no-reply@coolbeans.tools>',
		);
	});

	it('replaces an existing display name rather than keeping it', () => {
		// The configured name is "Cool Beans", which is the wrong answer for someone who
		// bought a vendor's app.
		expect(senderWithProductName('Cool Beans <no-reply@coolbeans.tools>', 'TideGlass')).toBe(
			'"TideGlass" <no-reply@coolbeans.tools>',
		);
	});

	it('keeps the self-host address while naming the product', () => {
		expect(senderWithProductName('receipts@theirdomain.com', 'Clementine')).toBe(
			'"Clementine" <receipts@theirdomain.com>',
		);
	});

	it('escapes quotes and backslashes in a product name', () => {
		// An unescaped quote truncates the display name and corrupts the header.
		expect(senderWithProductName('a@b.com', 'He said "hi"')).toBe('"He said \\"hi\\"" <a@b.com>');
		expect(senderWithProductName('a@b.com', 'back\\slash')).toBe('"back\\\\slash" <a@b.com>');
	});

	it('strips newlines so a product name cannot inject headers', () => {
		// A name reaching the header with a CRLF in it could append arbitrary headers, e.g.
		// a second Bcc. Flatten to spaces before quoting.
		const out = senderWithProductName('a@b.com', 'Evil\r\nBcc: attacker@example.com');
		expect(out).not.toContain('\r');
		expect(out).not.toContain('\n');
		expect(out).toBe('"Evil Bcc: attacker@example.com" <a@b.com>');
	});

	it('keeps commas inside the quoted name, so the address does not split', () => {
		// A comma in an unquoted display name reads as an address separator.
		expect(senderWithProductName('a@b.com', 'Acme, Inc.')).toBe('"Acme, Inc." <a@b.com>');
	});
});
