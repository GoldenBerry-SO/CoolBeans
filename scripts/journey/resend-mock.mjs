// ABOUTME: A stand-in for the Resend API, so journeys assert on the provider we actually ship.
// ABOUTME: Captures every send and exposes it for inspection; no container, no SMTP.

import { createServer } from 'node:http';

/**
 * Resend is the production sender (PRD §14), so the journeys have to exercise THAT
 * adapter rather than the SMTP one. This speaks the one endpoint the client calls and
 * keeps what it was given, which is also what makes "did the buyer actually get their
 * key" assertable without a mail container.
 */
const sent = [];

function json(res, body, status = 200) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve) => {
		let body = '';
		req.on('data', (c) => {
			body += c;
		});
		req.on('end', () => resolve(body));
	});
}

const server = createServer(async (req, res) => {
	const path = new URL(req.url ?? '/', 'http://localhost').pathname;

	// The Resend SDK posts here to send a message.
	if (req.method === 'POST' && path === '/emails') {
		const auth = req.headers.authorization ?? '';
		if (!auth.startsWith('Bearer ')) {
			// Mirrors Resend: a missing key is an auth failure, not a silent success.
			return json(res, { name: 'validation_error', message: 'Missing API key' }, 401);
		}
		const payload = JSON.parse(await readBody(req));
		const id = `mock_${sent.length + 1}`;
		sent.push({ id, ...payload, received_at: new Date().toISOString() });
		return json(res, { id });
	}

	// Journey control plane: read and reset the mailbox.
	if (req.method === 'GET' && path === '/__sent') return json(res, { messages: sent });
	if (req.method === 'DELETE' && path === '/__sent') {
		sent.length = 0;
		return json(res, { cleared: true });
	}

	json(res, { name: 'not_found', message: `resend-mock: unhandled ${req.method} ${path}` }, 404);
});

const port = Number(process.env.PORT ?? 12112);
server.listen(port, () => {
	console.log(`resend mock listening on ${port}`);
});
