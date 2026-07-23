// ABOUTME: resolveEmailIdentity — cloud sends from a verified address, self-host keeps custom.
// ABOUTME: The bug it fixes: a customer's email_from is rejected by Resend on cloud (unverified).

import { describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { resolveEmailIdentity } from './email.js';

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
