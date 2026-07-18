// ABOUTME: Console API client (PRD §16) — talks to the admin API with the stored bearer token.
// ABOUTME: The token lives in localStorage; the dev server proxies /admin and /v1 to the API.

const TOKEN_KEY = 'coolbeans.admin_token';

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
}

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
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
