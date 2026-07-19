// ABOUTME: TanStack Query hooks for the console (PRD §16) — read paths and mutations over the admin API.
// ABOUTME: Query keys are coarse; mutations invalidate the lists they affect.

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api.js';

/** Server messages are the useful half of an error; the class name is not. */
function message(err: unknown): string {
	return err instanceof Error ? err.message : 'Something went wrong.';
}

import type { AuditEntry, Billing, LicenseRow, Product, PurchaseRow } from './types.js';

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

export interface TeamMember {
	id: number;
	email: string;
	name: string | null;
	created_at: string;
	last_login_at: string | null;
}

export function useTeam() {
	return useQuery({
		queryKey: ['team'],
		queryFn: () => api<{ team: TeamMember[] }>('GET', '/admin/team').then((r) => r.team),
	});
}

export function useInviteAdmin() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (email: string) => api('POST', '/admin/team', { email }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
	});
}

export function useRevokeAdmin() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: number) => api('DELETE', `/admin/team/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['team'] });
			toast.success('Admin revoked', { description: 'Their sessions were dropped straight away.' });
		},
		onError: (err) => toast.error('Could not revoke that admin', { description: message(err) }),
	});
}

export interface UsageRow {
	key: string;
	product: string;
	metric: string;
	display_name: string;
	current: number;
	limit: number | null;
	resets_at: string | null;
}

export function useUsage() {
	return useQuery({
		queryKey: ['usage'],
		queryFn: () => api<{ usage: UsageRow[] }>('GET', '/admin/usage').then((r) => r.usage),
	});
}

export interface ProviderEvent {
	id: string;
	provider: string;
	type: string;
	status: string;
	received_at: string;
}

export function useProviderEvents() {
	return useQuery({
		queryKey: ['events'],
		queryFn: () => api<{ events: ProviderEvent[] }>('GET', '/admin/events').then((r) => r.events),
	});
}

export interface ProviderStatus {
	name: string;
	configured: boolean;
	path: string;
}

export function useProviders() {
	return useQuery({
		queryKey: ['providers'],
		queryFn: () =>
			api<{ providers: ProviderStatus[] }>('GET', '/admin/providers').then((r) => r.providers),
	});
}

export interface LicenseDetail {
	license: LicenseRow;
	activations: {
		instance_id: string;
		name: string;
		created_at: string;
		last_validated_at: string | null;
		lease_expires_at: string | null;
		deactivated_at: string | null;
	}[];
	usage: { metric: string; current: number; limit: number | null; resets_at: string | null }[];
}

export function useLicenseDetail(key: string) {
	return useQuery({
		queryKey: ['license', key],
		enabled: key.length > 0,
		queryFn: () => api<LicenseDetail>('GET', `/admin/keys/${encodeURIComponent(key)}`),
	});
}

export function useArchiveProduct() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (slug: string) => api('DELETE', `/admin/products/${slug}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['products'] });
			toast.success('Product archived', { description: 'Issued keys keep working.' });
		},
		onError: (err) => toast.error('Could not archive that product', { description: message(err) }),
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

export interface ValidationDay {
	day: string;
	count: number;
}

export function useValidations() {
	return useQuery({
		queryKey: ['validations'],
		queryFn: () =>
			api<{ validations: ValidationDay[] }>('GET', '/admin/validations').then((r) => r.validations),
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
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['licenses'] });
			qc.invalidateQueries({ queryKey: ['products'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
			toast.success(variables.action === 'disable' ? 'Key disabled' : 'Key re-enabled');
			// The detail page reads its own query; without this it keeps showing the old
			// status and the wrong action button until a reload.
			qc.invalidateQueries({ queryKey: ['license', variables.key] });
		},
		onError: (err) => toast.error('Could not change that key', { description: message(err) }),
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

export interface ConnectStripeResult {
	/** Where to point Stripe: the signing secret is per product. */
	webhook_path: string;
	secret_rotated: boolean;
	dunning: { setting: string; note: string };
}

export function useConnectStripe() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, ...input }: ConnectStripeInput) =>
			api<ConnectStripeResult>('POST', `/admin/products/${slug}/stripe/connect`, input),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
	});
}

/**
 * The account's plan, usage and billing state.
 *
 * `pollWhileFree` is what the ?upgraded=1 return uses: Stripe's webhook can land a beat
 * after the browser redirect, and a page that still says "Free" straight after payment
 * generates a support ticket every single time.
 */
export function useBilling(pollWhileFree = false) {
	return useQuery({
		queryKey: ['billing'],
		queryFn: () => api<{ billing: Billing }>('GET', '/admin/billing').then((r) => r.billing),
		refetchInterval: (query) => (pollWhileFree && query.state.data?.plan === 'free' ? 2000 : false),
	});
}

export function useStartCheckout() {
	return useMutation({
		mutationFn: () => api<{ url: string }>('POST', '/admin/billing/checkout'),
		onSuccess: (result) => {
			window.location.href = result.url;
		},
		onError: (err) => toast.error(message(err)),
	});
}

export function useOpenPortal() {
	return useMutation({
		mutationFn: () => api<{ url: string }>('POST', '/admin/billing/portal'),
		onSuccess: (result) => {
			window.location.href = result.url;
		},
		onError: (err) => toast.error(message(err)),
	});
}
