// ABOUTME: CSV/JSON export of licences (PRD §16, issue #42) — get your data out.
// ABOUTME: Escaping matters: a customer name with a comma must not shift every column.

import { beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../../test/harness.js';
import { createProduct, issueKey } from '../../test/seed.js';

let h: TestHarness;

beforeEach(async () => {
	h = await makeHarness();
	await createProduct(h.app, {
		slug: 'clementine',
		name: 'Clementine',
		key_prefix: 'CLEM',
		email_from: 'r@clementine.email',
	});
});

const get = (path: string) => h.app.request(path, { headers: h.adminHeaders });

describe('GET /admin/products/:slug/keys/export', () => {
	it('needs an admin token like every other console surface', async () => {
		const res = await h.app.request('/admin/products/clementine/keys/export');
		expect(res.status).toBe(401);
	});

	it('exports a header row and one row per licence as CSV', async () => {
		await issueKey(h.app, { product: 'clementine', email: 'a@example.com', kind: 'perpetual' });
		await issueKey(h.app, { product: 'clementine', email: 'b@example.com', kind: 'subscription' });

		const res = await get('/admin/products/clementine/keys/export');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/csv');
		// A filename makes the browser save it as a file rather than render it.
		expect(res.headers.get('content-disposition')).toContain('clementine');

		const lines = (await res.text()).trim().split('\n');
		expect(lines[0]).toBe('key,status,kind,plan,customer_email,created_at,expires_at,seats_used');
		expect(lines).toHaveLength(3);
		expect(lines.join('\n')).toContain('a@example.com');
		expect(lines.join('\n')).toContain('b@example.com');
	});

	it('quotes and escapes fields so a comma cannot shift the columns', async () => {
		// Emails cannot contain commas, but notes and product names can, and a field that
		// silently breaks the row shape turns an export into corrupt data.
		const { csvRow } = await import('./export.js');
		expect(csvRow(['plain', 'has,comma'])).toBe('plain,"has,comma"');
		expect(csvRow(['say "hi"'])).toBe('"say ""hi"""');
		expect(csvRow(['line\nbreak'])).toBe('"line\nbreak"');
		expect(csvRow([null, undefined, ''])).toBe(',,');
	});

	it('never lets a leading =, +, - or @ execute in a spreadsheet', async () => {
		// CSV injection: a cell starting with = is a formula when opened in Excel.
		const { csvRow } = await import('./export.js');
		expect(csvRow(['=1+1'])).toBe("'=1+1");
		expect(csvRow(['+cmd'])).toBe("'+cmd");
		expect(csvRow(['-2'])).toBe("'-2");
		expect(csvRow(['@SUM'])).toBe("'@SUM");
	});

	it('exports JSON when asked', async () => {
		await issueKey(h.app, { product: 'clementine', email: 'a@example.com', kind: 'perpetual' });
		const res = await get('/admin/products/clementine/keys/export?format=json');
		expect(res.headers.get('content-type')).toContain('application/json');
		const body = (await res.json()) as { keys: Array<{ customer_email: string }> };
		expect(body.keys).toHaveLength(1);
		expect(body.keys[0]?.customer_email).toBe('a@example.com');
	});

	it('404s for a product that does not exist', async () => {
		const res = await get('/admin/products/nope/keys/export');
		expect(res.status).toBe(404);
	});
});
