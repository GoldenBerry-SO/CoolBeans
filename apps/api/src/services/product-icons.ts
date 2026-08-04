// ABOUTME: Product icons (issue #115) — validate, store, and read the vendor's logo.
// ABOUTME: Magic-byte sniffing over trusting the client's mime; the cap keeps rows email-sized.

import type { Product } from '@coolbeans/db';
import { productIcons } from '@coolbeans/db';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { validationError } from '../http/errors.js';

/** 256KB decoded: generous for a logo, small enough to live comfortably in a row. */
export const ICON_MAX_BYTES = 256 * 1024;

export const ICON_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * What the bytes actually are, from their magic numbers. The claimed mime is a statement;
 * the signature is evidence — a mislabeled blob is refused rather than served under an
 * image content-type it does not match. SVG is deliberately unsniffed and unsupported:
 * mail clients barely render it and, served inline, it is a script vector.
 */
export function sniffImageMime(bytes: Buffer): (typeof ICON_MIMES)[number] | null {
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
		bytes.subarray(8, 12).toString('latin1') === 'WEBP'
	) {
		return 'image/webp';
	}
	return null;
}

export async function setProductIcon(
	deps: AppDeps,
	product: Product,
	args: { mime: string; dataBase64: string },
): Promise<void> {
	if (!(ICON_MIMES as readonly string[]).includes(args.mime)) {
		throw validationError(`The icon must be one of: ${ICON_MIMES.join(', ')}.`);
	}
	let bytes: Buffer;
	try {
		bytes = Buffer.from(args.dataBase64, 'base64');
	} catch {
		throw validationError('data_base64 is not valid base64.');
	}
	if (bytes.length === 0) throw validationError('The upload is empty.');
	if (bytes.length > ICON_MAX_BYTES) {
		throw validationError('The icon is too large — the cap is 256KB.');
	}
	const sniffed = sniffImageMime(bytes);
	if (sniffed !== args.mime) {
		throw validationError(
			'Those bytes are not the claimed image type. Upload a real PNG, JPEG, or WebP.',
		);
	}
	const updatedAt = nowDate(deps).toISOString();
	await deps.db
		.insert(productIcons)
		.values({ productId: product.id, mime: args.mime, data: bytes.toString('base64'), updatedAt })
		.onConflictDoUpdate({
			target: productIcons.productId,
			set: { mime: args.mime, data: bytes.toString('base64'), updatedAt },
		});
}

export async function deleteProductIcon(deps: AppDeps, product: Product): Promise<void> {
	await deps.db.delete(productIcons).where(eq(productIcons.productId, product.id));
}

export async function getProductIcon(
	deps: AppDeps,
	productId: number,
): Promise<{ mime: string; bytes: Buffer } | null> {
	const [row] = await deps.db
		.select()
		.from(productIcons)
		.where(eq(productIcons.productId, productId))
		.limit(1);
	if (!row) return null;
	return { mime: row.mime, bytes: Buffer.from(row.data, 'base64') };
}

/** Existence only — the email path must never drag the blob into memory. */
export async function hasProductIcon(deps: AppDeps, productId: number): Promise<boolean> {
	const [row] = await deps.db
		.select({ productId: productIcons.productId })
		.from(productIcons)
		.where(eq(productIcons.productId, productId))
		.limit(1);
	return Boolean(row);
}
