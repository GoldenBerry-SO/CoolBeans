// ABOUTME: HTTP client for the beans CLI — talks to the Cool Beans admin API with a bearer token.
// ABOUTME: Reads base URL + token from env/flags; never echoes the token.

export interface ClientOptions {
	url: string;
	token: string;
}

export function resolveClient(flags: { url?: string; token?: string }): ClientOptions {
	const url = flags.url ?? process.env.COOLBEANS_URL ?? 'http://localhost:3000';
	const token = flags.token ?? process.env.COOLBEANS_ADMIN_TOKEN ?? '';
	if (!token) {
		throw new Error('No admin token. Set COOLBEANS_ADMIN_TOKEN or pass --token.');
	}
	return { url: url.replace(/\/$/, ''), token };
}

export async function apiRequest(
	client: ClientOptions,
	method: string,
	path: string,
	body?: unknown,
): Promise<unknown> {
	const res = await fetch(`${client.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${client.token}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		json = { raw: text };
	}
	if (!res.ok) {
		const message = (json as { message?: string; error?: string }).message ?? res.statusText;
		throw new Error(`${res.status}: ${message}`);
	}
	return json;
}
