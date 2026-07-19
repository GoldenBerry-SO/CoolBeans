// ABOUTME: Console API client (PRD §16) — talks to the admin API with the stored bearer token.
// ABOUTME: The token lives in localStorage; the dev server proxies /admin and /v1 to the API.

const TOKEN_KEY = 'coolbeans.admin_token';
const EMAIL_KEY = 'coolbeans.admin_email';
export const AUTH_INVALID_EVENT = 'coolbeans:auth-invalid';

// Guard against non-browser contexts (server-side test rendering).
const store = typeof localStorage !== 'undefined' ? localStorage : null;

export function getToken(): string | null {
	return store?.getItem(TOKEN_KEY) ?? null;
}
export function setToken(token: string): void {
	store?.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
	store?.removeItem(TOKEN_KEY);
	store?.removeItem(EMAIL_KEY);
}

/**
 * A token can become invalid while it is stored (for example after ADMIN_TOKEN rotates).
 * Clear it and notify the auth provider so the console returns to sign-in instead of
 * leaving the operator in a dashboard where every query silently answers 401.
 */
function invalidateAuth(): void {
	clearToken();
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
}
export function getAdminEmail(): string | null {
	return store?.getItem(EMAIL_KEY) ?? null;
}
export function setAdminEmail(email: string): void {
	store?.setItem(EMAIL_KEY, email);
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Download a file from an authed endpoint. A plain link cannot carry the bearer token, so
 * fetch it, then hand the browser a blob to save.
 */
export async function download(path: string, filename: string): Promise<void> {
	const token = getToken();
	const res = await fetch(path, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
	if (!res.ok) {
		if (res.status === 401) invalidateAuth();
		throw new ApiError(res.status, `Export failed (${res.status})`);
	}
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking immediately can cancel the save in some browsers; a tick is enough.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
	const token = getToken();
	const res = await fetch(path, {
		method,
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) {
		if (res.status === 401) invalidateAuth();
		throw new ApiError(res.status, (json as { message?: string }).message ?? res.statusText);
	}
	return json as T;
}

/** Public (unauthed) call for the customer portal. */
export async function publicApi<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(path, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok)
		throw new ApiError(res.status, (json as { message?: string }).message ?? res.statusText);
	return json as T;
}
