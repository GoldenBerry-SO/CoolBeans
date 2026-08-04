// ABOUTME: Tests for the price display helpers used by the Stripe price picker.
// ABOUTME: A price must read as "which product, which price" — a bare nickname is ambiguous.

import { describe, expect, it } from 'vitest';
import { priceAmount, priceName } from './price-label.js';
import type { StripePriceRow } from './queries.js';

function row(overrides: Partial<StripePriceRow>): StripePriceRow {
	return {
		id: 'price_1QabcXYZ',
		nickname: null,
		product_name: null,
		unit_amount: null,
		currency: null,
		recurring: false,
		interval: null,
		mapped: null,
		...overrides,
	};
}

describe('priceName', () => {
	it('shows the product name next to the nickname, so same-named prices across products stay tellable apart', () => {
		expect(priceName(row({ product_name: 'Clementine', nickname: 'Pro yearly' }))).toBe(
			'Clementine · Pro yearly',
		);
	});

	it('falls back to the product name alone when the price has no nickname', () => {
		expect(priceName(row({ product_name: 'Clementine' }))).toBe('Clementine');
	});

	it('falls back to the nickname alone when Stripe reports no product name', () => {
		expect(priceName(row({ nickname: 'Pro yearly' }))).toBe('Pro yearly');
	});

	it('falls back to the raw id when there is nothing human to show', () => {
		expect(priceName(row({}))).toBe('price_1QabcXYZ');
	});
});

describe('priceAmount', () => {
	it('renders a recurring price with its interval', () => {
		expect(
			priceAmount(row({ unit_amount: 4900, currency: 'eur', recurring: true, interval: 'year' })),
		).toMatch(/49.*\/year$/);
	});

	it('renders a one-time price', () => {
		expect(priceAmount(row({ unit_amount: 12000, currency: 'usd' }))).toMatch(/120.*one-time$/);
	});

	it('says "recurring" when Stripe reports no fixed amount', () => {
		expect(priceAmount(row({ recurring: true, interval: 'month' }))).toBe('recurring/month');
	});
});
