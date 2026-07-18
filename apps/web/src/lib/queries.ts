// ABOUTME: TanStack Query hooks for the console (PRD §16) — read paths and mutations over the admin API.
// ABOUTME: Query keys are coarse; mutations invalidate the lists they affect.

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import type { AuditEntry, LicenseRow, Product, PurchaseRow } from './types.js';

export function useProducts() {
	return useQuery({
		queryKey: ['products'],
		queryFn: () => api<{ products: Product[] }>('GET', '/admin/products').then((r) => r.products),
	});
}

export function useLicenses(productSlug: string | null, status: string) {
	return useQuery({
		queryKey: ['licenses', productSlug, status],
		enabled: !!productSlug,
		queryFn: () => {
			const q = status !== 'all' ? `?status=${status}` : '';
			return api<{ keys: LicenseRow[] }>('GET', `/admin/products/${productSlug}/keys${q}`).then(
				(r) => r.keys,
			);
		},
	});
}

/** Keys across many products at once — the licenses page's "All products" view. */
export function useLicensesAcross(productSlugs: string[], status: string) {
	const q = status !== 'all' ? `?status=${status}` : '';
	return useQueries({
		queries: productSlugs.map((slug) => ({
			queryKey: ['licenses', slug, status],
			queryFn: () =>
				api<{ keys: LicenseRow[] }>('GET', `/admin/products/${slug}/keys${q}`).then((r) =>
					r.keys.map((k) => ({ ...k, product: slug })),
				),
		})),
		combine: (results) => ({
			isLoading: results.some((r) => r.isLoading),
			data: results.flatMap((r) => r.data ?? []),
		}),
	});
}

export interface Stats {
	products: number;
	active_licenses: number;
	total_licenses: number;
	live_activations: number;
}

export function useStats() {
	return useQuery({
		queryKey: ['stats'],
		queryFn: () => api<{ stats: Stats }>('GET', '/admin/stats').then((r) => r.stats),
	});
}

export function useAudit() {
	return useQuery({
		queryKey: ['audit'],
		queryFn: () => api<{ audit: AuditEntry[] }>('GET', '/admin/audit').then((r) => r.audit),
	});
}

export function usePurchasesByEmail(email: string) {
	return useQuery({
		queryKey: ['purchases', email],
		enabled: email.length > 2,
		queryFn: () =>
			api<{ purchases: PurchaseRow[] }>(
				'GET',
				`/admin/purchases?email=${encodeURIComponent(email)}`,
			).then((r) => r.purchases),
	});
}

export interface IssueKeyInput {
	product: string;
	email: string;
	tier: string;
	trial_days?: number;
}

export function useIssueKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: IssueKeyInput) => api<{ key: string }>('POST', '/admin/keys', input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['licenses'] });
			qc.invalidateQueries({ queryKey: ['products'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export function useSetLicenseStatus() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ key, action }: { key: string; action: 'disable' | 'enable' }) =>
			api('POST', `/admin/keys/${encodeURIComponent(key)}/${action}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['licenses'] });
			qc.invalidateQueries({ queryKey: ['products'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export interface CreateProductInput {
	slug: string;
	name: string;
	key_prefix: string;
	email_from: string;
	activation_limit?: number;
	activation_model?: string;
}

export function useCreateProduct() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateProductInput) => api('POST', '/admin/products', input),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
	});
}

export function useUpdateProduct() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, ...input }: Partial<CreateProductInput> & { slug: string }) =>
			api('PATCH', `/admin/products/${slug}`, input),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
	});
}

export interface ConnectStripeInput {
	slug: string;
	webhook_url: string;
	lifetime_amount: number;
	yearly_amount: number;
}

export function useConnectStripe() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, ...input }: ConnectStripeInput) =>
			api('POST', `/admin/products/${slug}/stripe/connect`, input),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
	});
}
