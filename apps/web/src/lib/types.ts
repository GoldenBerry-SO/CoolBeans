// ABOUTME: Shared response types for the console — mirror the admin API's JSON shapes.
// ABOUTME: Kept small and local; the API is the source of truth for the actual fields.

export interface Product {
	id: number;
	slug: string;
	name: string;
	keyPrefix: string;
	activationLimit: number;
	activationModel: 'node_locked' | 'floating';
	emailFrom: string;
	stripePriceLifetime: string | null;
	stripePriceYearly: string | null;
	keysTotal: number;
	keysActive: number;
}

export interface LicenseRow {
	key: string;
	status: 'active' | 'disabled';
	tier: 'lifetime' | 'yearly' | 'trial';
	product: string;
	expires_at: string | null;
	id: number;
	normalized_key: string;
	disabled_reason: string | null;
	created_at: string;
	email_sent_at: string | null;
	live_seats: number;
	activation_limit: number;
	customer_email: string | null;
}

export interface AuditEntry {
	id: number;
	action: string;
	actor: string;
	product_id: number | null;
	license_id: number | null;
	detail: Record<string, unknown> | null;
	created_at: string;
}

export interface PurchaseRow {
	id: number;
	provider: string;
	email: string;
	created_at: string;
}

export interface PlanUsage {
	current: number;
	/** Null means no cap: Pro, or a self-host instance, which has no limits at all. */
	limit: number | null;
}

export interface Billing {
	/**
	 * False on a self-host instance. The console hides the billing page and its nav entry
	 * entirely in that case: PRD §7 says self-host is unlimited and free forever, so an
	 * upgrade button there would be selling something they already own.
	 */
	enabled: boolean;
	plan: 'free' | 'pro';
	status: string | null;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	past_due_since: string | null;
	over_limit_since: string | null;
	usage: { products: PlanUsage; active_licenses: PlanUsage };
}
