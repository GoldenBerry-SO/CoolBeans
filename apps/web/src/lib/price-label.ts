// ABOUTME: Display helpers for Stripe prices in the picker and grant lists.
// ABOUTME: A price reads as "which product, which price" — a bare nickname is ambiguous across products.

import type { StripePriceRow } from './queries.js';

/**
 * "Clementine · Pro yearly" — the Stripe product name stays visible next to the price
 * nickname, because an account selling several products repeats nicknames like "Yearly".
 */
export function priceName(p: StripePriceRow): string {
	if (p.product_name && p.nickname) return `${p.product_name} · ${p.nickname}`;
	return p.product_name ?? p.nickname ?? p.id;
}

/** "€49/year", "€120 one-time" — the way a human recognizes a price. */
export function priceAmount(p: StripePriceRow): string {
	const amount =
		p.unit_amount !== null && p.currency
			? new Intl.NumberFormat(undefined, {
					style: 'currency',
					currency: p.currency.toUpperCase(),
					maximumFractionDigits: p.unit_amount % 100 === 0 ? 0 : 2,
				}).format(p.unit_amount / 100)
			: null;
	if (p.recurring) return `${amount ?? 'recurring'}/${p.interval ?? 'period'}`;
	return `${amount ?? ''} one-time`.trim();
}
