// ABOUTME: TanStack Query hooks for the console (PRD §16) — read paths and mutations over the admin API.
// ABOUTME: Query keys are coarse; mutations invalidate the lists they affect.

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api.js';

/** Server messages are the useful half of an error; the class name is not. */
function message(err: unknown): string {
	return err instanceof Error ? err.message : 'Something went wrong.';
}

import type { EntitlementMap } from './entitlements.js';
import type { AuditEntry, Billing, LicenseRow, Product, PurchaseRow } from './types.js';

export function useProducts() {
	return useQuery({
		queryKey: ['products'],
		queryFn: () => api<{ products: Product[] }>('GET', '/admin/products').then((r) => r.products),
	});
}

/**
 * A product's public signing keys (kid -> key) for offline verification, from the public
 * /v1/pubkey endpoint. Used by the Integration view to show and embed them. No secret here:
 * these are public keys, the same ones an SDK fetches.
 */
export function useProductPubkeys(slug: string) {
	return useQuery({
		queryKey: ['pubkey', slug],
		enabled: slug.length > 0,
		queryFn: () =>
			api<{ keys: Record<string, string> }>(
				'GET',
				`/v1/pubkey?product=${encodeURIComponent(slug)}`,
			).then((r) => r.keys),
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

/** The account's most recent licences across every product, for the Overview card (#60). */
export function useRecentLicenses(limit = 5) {
	return useQuery({
		queryKey: ['recent-licenses', limit],
		queryFn: () =>
			api<{ keys: LicenseRow[] }>('GET', `/admin/licenses?limit=${limit}`).then((r) => r.keys),
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
	/** Handler failures so far; non-zero on a done row means a retry recovered it. */
	attempts: number;
	last_error: string | null;
	received_at: string;
}

export function useProviderEvents() {
	return useQuery({
		queryKey: ['events'],
		queryFn: () => api<{ events: ProviderEvent[] }>('GET', '/admin/events').then((r) => r.events),
	});
}

export interface WebhookEndpoint {
	id: number;
	url: string;
	events: string[];
	status: 'active' | 'disabled';
	created_at: string;
}

export interface WebhookDeliveryRow {
	id: number;
	event_type: string;
	status: 'pending' | 'delivered' | 'failed';
	attempts: number;
	last_error: string | null;
	delivered_at: string | null;
	created_at: string;
}

export function useWebhookEventTypes() {
	return useQuery({
		queryKey: ['webhook-event-types'],
		queryFn: () =>
			api<{ event_types: string[] }>('GET', '/admin/webhooks/event-types').then(
				(r) => r.event_types,
			),
	});
}

export function useWebhookEndpoints() {
	return useQuery({
		queryKey: ['webhook-endpoints'],
		queryFn: () =>
			api<{ endpoints: WebhookEndpoint[] }>('GET', '/admin/webhooks/endpoints').then(
				(r) => r.endpoints,
			),
	});
}

export function useWebhookDeliveries(endpointId: number | null) {
	return useQuery({
		queryKey: ['webhook-deliveries', endpointId],
		enabled: endpointId !== null,
		queryFn: () =>
			api<{ deliveries: WebhookDeliveryRow[] }>(
				'GET',
				`/admin/webhooks/endpoints/${endpointId}/deliveries`,
			).then((r) => r.deliveries),
	});
}

export function useCreateWebhookEndpoint() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: { url: string; events: string[] }) =>
			api<{ endpoint: WebhookEndpoint & { secret: string } }>(
				'POST',
				'/admin/webhooks/endpoints',
				input,
			).then((r) => r.endpoint),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-endpoints'] }),
		onError: (err) => toast.error('Could not add that endpoint', { description: message(err) }),
	});
}

export function useRotateWebhookSecret() {
	return useMutation({
		mutationFn: (id: number) =>
			api<{ secret: string }>('POST', `/admin/webhooks/endpoints/${id}/rotate`).then(
				(r) => r.secret,
			),
		onError: (err) => toast.error('Could not rotate the secret', { description: message(err) }),
	});
}

export function useDisableWebhookEndpoint() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: number) => api('DELETE', `/admin/webhooks/endpoints/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['webhook-endpoints'] });
			toast.success('Endpoint removed', { description: 'Its delivery history is kept.' });
		},
		onError: (err) => toast.error('Could not remove that endpoint', { description: message(err) }),
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

/**
 * A per-product cache-buster for the icon URL. The card and dialog <img>s key on it, so
 * bumping it after a mutation makes them refetch (and un-latch a previous 404) without
 * the products API having to carry an icon flag or version.
 */
export function useIconVersion(slug: string): number {
	const { data } = useQuery({
		queryKey: ['icon-version', slug],
		queryFn: () => 0,
		staleTime: Number.POSITIVE_INFINITY,
		initialData: 0,
	});
	return data;
}

function bumpIconVersion(qc: ReturnType<typeof useQueryClient>, slug: string): void {
	qc.setQueryData(['icon-version', slug], Date.now());
}

export function useSetProductIcon() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			slug,
			mime,
			data_base64,
		}: {
			slug: string;
			mime: string;
			data_base64: string;
		}) => api('PUT', `/admin/products/${slug}/icon`, { mime, data_base64 }),
		onSuccess: (_data, variables) => {
			bumpIconVersion(qc, variables.slug);
			toast.success('Icon saved', { description: 'Licence emails now carry your logo.' });
		},
		onError: (err) => toast.error('Could not save that icon', { description: message(err) }),
	});
}

export function useRemoveProductIcon() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (slug: string) => api('DELETE', `/admin/products/${slug}/icon`),
		onSuccess: (_data, slug) => {
			bumpIconVersion(qc, slug);
			toast.success('Icon removed', { description: 'Emails fall back to the Cool Beans logo.' });
		},
		onError: (err) => toast.error('Could not remove the icon', { description: message(err) }),
	});
}

export function useArchiveProduct() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (slug: string) => api('DELETE', `/admin/products/${slug}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['products'] });
			// Archiving frees a plan slot, so the cap indicator is now wrong.
			qc.invalidateQueries({ queryKey: ['billing'] });
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
	activations_7d: number;
}

export function useStats() {
	return useQuery({
		queryKey: ['stats'],
		queryFn: () => api<{ stats: Stats }>('GET', '/admin/stats').then((r) => r.stats),
	});
}

export interface ValidationDay {
	day: string;
	/** Distinct licences that checked in that day — the bar the vendor reads. */
	licenses: number;
	/** Raw check volume (tooltip detail; launches × devices, not customers). */
	checks: number;
	/** Checks that answered valid:false — lapsed keys still phoning home. */
	refused: number;
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
	kind: string;
	plan?: string;
	/** Seats this licence gets. Omitted inherits the product's limit. */
	activation_limit?: number;
	/**
	 * Capabilities this licence carries. A hand-issued licence has no price to inherit them
	 * from, so a comped Pro key would otherwise be indistinguishable from Basic.
	 */
	entitlements?: EntitlementMap;
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
			// A new key moves the active-licence count against the plan.
			qc.invalidateQueries({ queryKey: ['billing'] });
		},
	});
}

export function useExtendLicense() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ key, expires_at }: { key: string; expires_at: string }) =>
			api('POST', `/admin/keys/${encodeURIComponent(key)}/extend`, { expires_at }),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ['license', variables.key] });
			qc.invalidateQueries({ queryKey: ['licenses'] });
			toast.success('Expiry extended', {
				description: 'The app picks it up on its next check.',
			});
		},
		onError: (err) => toast.error('Could not extend that key', { description: message(err) }),
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
			// Only active licences count toward the plan, so both directions move it.
			qc.invalidateQueries({ queryKey: ['billing'] });
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
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['products'] });
			// Without this the plan cap is stale: a Free account that just used its one
			// product still sees an enabled New product button until the page is reloaded.
			qc.invalidateQueries({ queryKey: ['billing'] });
		},
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
}

export interface ConnectStripeResult {
	/** Where to point Stripe: one connection-level endpoint for every product. */
	webhook_path: string;
	secret_rotated: boolean;
	dunning: { setting: string; note: string };
	/** Present on a cloud Connect account, whose events already arrive on the platform endpoint. */
	note?: string;
}

export function useConnectStripe() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, ...input }: ConnectStripeInput) =>
			api<ConnectStripeResult>('POST', `/admin/products/${slug}/stripe/connect`, input),
		onSuccess: (_data, { slug }) => {
			qc.invalidateQueries({ queryKey: ['products'] });
			qc.invalidateQueries({ queryKey: ['grants', slug] });
		},
	});
}

/**
 * Cloud onboarding: ask for the Stripe authorization URL and send the vendor there. The state
 * that binds the callback to this account is minted server side, so the browser only ever
 * carries the URL.
 */
export function useStartStripeConnect() {
	return useMutation({
		mutationFn: () => api<{ url: string }>('POST', '/admin/stripe/connect/authorize'),
		onSuccess: (res) => {
			window.location.href = res.url;
		},
		onError: (err) => toast.error('Could not start Stripe Connect', { description: message(err) }),
	});
}

export interface Grant {
	id: number;
	stripePriceId: string;
	kind: 'perpetual' | 'subscription';
	plan: string | null;
	/** Seats this price buys; null inherits the product's limit. */
	activationLimit: number | null;
	/** The capabilities this price buys, signed into every token it issues. Null grants none. */
	entitlements: EntitlementMap | null;
	status: 'active' | 'retired';
	createdAt: string;
}

/** The active price -> product mappings for one product. */
export function useGrants(slug: string) {
	return useQuery({
		queryKey: ['grants', slug],
		queryFn: () =>
			api<{ grants: Grant[] }>('GET', `/admin/products/${slug}/grants`).then((r) => r.grants),
	});
}

export interface CreateGrantInput {
	slug: string;
	stripe_price_id: string;
	kind: 'perpetual' | 'subscription';
	plan?: string;
	activation_limit?: number;
	/** Omitted keeps whatever the price already grants, rather than clearing it. */
	entitlements?: EntitlementMap;
}

export function useCreateGrant() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, ...input }: CreateGrantInput) =>
			api<{ grant: Grant }>('POST', `/admin/products/${slug}/grants`, input),
		onSuccess: (_data, { slug }) => {
			qc.invalidateQueries({ queryKey: ['grants', slug] });
			qc.invalidateQueries({ queryKey: ['products'] });
			toast.success('Price mapped');
		},
		onError: (err) => toast.error('Could not map that price', { description: message(err) }),
	});
}

export function useRetireGrant() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ slug, id }: { slug: string; id: number }) =>
			api('POST', `/admin/products/${slug}/grants/${id}/retire`),
		onSuccess: (_data, { slug }) => {
			qc.invalidateQueries({ queryKey: ['grants', slug] });
			qc.invalidateQueries({ queryKey: ['products'] });
			toast.success('Price retired', { description: 'Existing licences keep working.' });
		},
		onError: (err) => toast.error('Could not retire that price', { description: message(err) }),
	});
}

/** How long the post-checkout page keeps waiting for Stripe's webhook before giving up. */
const CHECKOUT_POLL_MS = 2000;
const CHECKOUT_POLL_LIMIT = 8;

/**
 * The account's plan, usage and billing state.
 *
 * `pollWhileFree` is what the ?upgraded=1 return uses: Stripe's webhook can land a beat
 * after the browser redirect, and a page that still says "Free" straight after payment
 * generates a support ticket every single time.
 *
 * The poll is bounded. If the payment genuinely failed the plan never flips, and an
 * unbounded interval would hammer the API every two seconds for as long as the tab is
 * left open.
 */
export function useBilling(pollWhileFree = false) {
	return useQuery({
		queryKey: ['billing'],
		queryFn: () => api<{ billing: Billing }>('GET', '/admin/billing').then((r) => r.billing),
		refetchInterval: (query) => {
			if (!pollWhileFree || query.state.data?.plan !== 'free') return false;
			return query.state.dataUpdateCount > CHECKOUT_POLL_LIMIT ? false : CHECKOUT_POLL_MS;
		},
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

export interface OfflineActivationResult {
	token: string;
	instance_id: string;
	/** When the blob stops working. Always set, even on a lifetime licence: see the route. */
	expires_at: string;
}

/**
 * Mint an activation for a machine that cannot reach us. The operator pastes the device's
 * fingerprint; the resulting blob is carried back to that machine by hand.
 */
export function useOfflineActivation() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ key, fingerprint }: { key: string; fingerprint: string }) =>
			api<OfflineActivationResult>(
				'POST',
				`/admin/keys/${encodeURIComponent(key)}/offline-activation`,
				{ fingerprint },
			),
		onSuccess: (_data, variables) => {
			// It consumed a real seat, so the seat count on this page is now stale.
			qc.invalidateQueries({ queryKey: ['license', variables.key] });
			qc.invalidateQueries({ queryKey: ['licenses'] });
		},
		onError: (err) =>
			toast.error('Could not create that activation', { description: message(err) }),
	});
}
