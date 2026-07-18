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
