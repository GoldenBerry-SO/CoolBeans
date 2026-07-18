// ABOUTME: Sender adapter tests — the console sender for dev, and the Resend payload we ship.
// ABOUTME: Resend is the production path (PRD §14), so its request shape is pinned here.

import { describe, expect, it, vi } from 'vitest';
import { createConsoleSender, createResendSender } from './senders.js';

const email = {
	from: 'Clementine <receipts@clementine.email>',
	to: 'buyer@example.com',
	subject: 'Your Clementine license key',
	html: '<p>CLEM-AAAA-BBBB-CCCC-DDDD</p>',
};

describe('console sender (development)', () => {
	it('hands the whole email to the sink instead of sending it anywhere', async () => {
		const captured: unknown[] = [];
		await createConsoleSender((e) => captured.push(e)).send(email);
		expect(captured).toEqual([email]);
	});

	it('never touches the network', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await createConsoleSender(() => {}).send(email);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});

describe('resend sender (production)', () => {
	it('posts the rendered email to the Resend API with the key', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			calls.push({ url: String(url), init: init as RequestInit });
			return new Response(JSON.stringify({ id: 'mock' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});

		await createResendSender('re_test_key', 'http://localhost:12112').send(email);

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/emails');
		// The SDK may pass a Headers instance or a plain object; read either.
		const headers = calls[0].init.headers;
		const auth =
			headers instanceof Headers
				? headers.get('Authorization')
				: (headers as Record<string, string>)?.Authorization;
		expect(String(auth)).toContain('re_test_key');
		const body = JSON.parse(String(calls[0].init.body));
		expect(body).toMatchObject({
			from: email.from,
			to: email.to,
			subject: email.subject,
			html: email.html,
		});
		fetchSpy.mockRestore();
	});
});
