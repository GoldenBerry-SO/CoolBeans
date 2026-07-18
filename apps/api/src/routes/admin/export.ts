// ABOUTME: Licence export (PRD §16, issue #42) — get your data out as CSV or JSON.
// ABOUTME: Nobody should have to ask us for a database dump to do their books or to leave.

import { licenses } from '@coolbeans/db';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { desc, eq } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/errors.js';
import { getProductBySlug } from '../../store/products.js';
import { adminLicenseView } from './keys.js';
import { assertScope } from './util.js';

/**
 * One CSV row, quoted the way RFC 4180 wants and defused for spreadsheets.
 *
 * Two separate problems. A comma, quote or newline inside a value would break the row
 * shape and silently corrupt every column after it. And a value starting with =, +, - or
 * @ is run as a formula when the file is opened in Excel or Sheets, so it gets an
 * apostrophe in front — the standard defusal.
 */
export function csvRow(values: Array<string | number | null | undefined>): string {
	return values
		.map((raw) => {
			if (raw === null || raw === undefined) return '';
			let value = String(raw);
			if (/^[=+\-@]/.test(value)) value = `'${value}`;
			if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
			return value;
		})
		.join(',');
}

const COLUMNS = [
	'key',
	'status',
	'tier',
	'customer_email',
	'created_at',
	'expires_at',
	'seats_used',
];

export function registerAdminExportRoutes(admin: OpenAPIHono, deps: AppDeps): void {
	admin.get('/products/:slug/keys/export', (c) => {
		const product = getProductBySlug(deps.db, c.req.param('slug'));
		if (!product) throw notFound('No product with that slug.');
		assertScope(c, product);

		const rows = deps.db
			.select()
			.from(licenses)
			.where(eq(licenses.productId, product.id))
			.orderBy(desc(licenses.createdAt))
			.all()
			.map((l) => adminLicenseView(deps, l, product));

		if (c.req.query('format') === 'json') {
			return c.json({ ok: true, keys: rows });
		}

		const body = [
			csvRow(COLUMNS),
			...rows.map((r) =>
				csvRow([
					r.key,
					r.status,
					r.tier,
					r.customer_email,
					r.created_at,
					r.expires_at,
					r.live_seats,
				]),
			),
		].join('\n');

		return c.body(body, 200, {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${product.slug}-licenses.csv"`,
		});
	});
}
