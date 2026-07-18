// ABOUTME: The OpenAPI description of the frozen public contract (PRD §9, issue #48).
// ABOUTME: Hand-written because §9 is frozen: it changes on purpose, with the spec, or not at all.

const licenseSchema = {
	type: 'object',
	required: ['key', 'status', 'tier', 'product', 'expires_at'],
	properties: {
		key: { type: 'string', example: 'CLEM-A2B3-C4D5-E6F7-H8JK' },
		status: { type: 'string', enum: ['active', 'disabled'] },
		tier: { type: 'string', enum: ['lifetime', 'yearly', 'trial'] },
		product: { type: 'string', example: 'clementine' },
		expires_at: {
			type: ['string', 'null'],
			description: 'ISO 8601, or null for lifetime. Advisory for yearly; enforced for trial.',
		},
	},
} as const;

const errorSchema = {
	type: 'object',
	required: ['ok', 'error', 'message'],
	properties: {
		ok: { type: 'boolean', enum: [false] },
		error: { type: 'string' },
		message: { type: 'string' },
	},
} as const;

const instanceSchema = {
	type: 'object',
	required: ['id', 'name'],
	properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
} as const;

function jsonBody(schema: unknown, description: string) {
	return { description, content: { 'application/json': { schema } } };
}

function errors(codes: [string, string][]) {
	return Object.fromEntries(codes.map(([code, desc]) => [code, jsonBody(errorSchema, desc)]));
}

/** Paths for the frozen §9 surface. Every entry is pinned by a test against the live routes. */
export const publicPaths = {
	'/v1/activate': {
		post: {
			summary: 'Activate a device against a license key',
			tags: ['Public'],
			requestBody: jsonBody(
				{
					type: 'object',
					required: ['license_key', 'instance_name'],
					properties: { license_key: { type: 'string' }, instance_name: { type: 'string' } },
				},
				'The key and a human device name.',
			),
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'license', 'instance'],
						properties: {
							ok: { type: 'boolean' },
							license: licenseSchema,
							instance: instanceSchema,
						},
					},
					'Activated. Reactivating the same device reuses its instance.',
				),
				...errors([
					['403', 'license_disabled — fail closed.'],
					['404', 'unknown_key — never read as revocation.'],
					['409', 'activation_limit_reached — the message names the limit.'],
					['422', 'invalid_key — failed the format check.'],
				]),
			},
		},
	},
	'/v1/validate': {
		post: {
			summary: 'Validate a key and instance (advisory; clients stay offline-tolerant)',
			tags: ['Public'],
			requestBody: jsonBody(
				{
					type: 'object',
					required: ['license_key', 'instance_id'],
					properties: { license_key: { type: 'string' }, instance_id: { type: 'string' } },
				},
				'The key and the instance id from activate.',
			),
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'valid', 'license', 'instance'],
						properties: {
							ok: { type: 'boolean' },
							valid: { type: 'boolean' },
							license: licenseSchema,
							instance: { oneOf: [instanceSchema, { type: 'null' }] },
							token: {
								type: 'string',
								description: 'Signed offline token (§11), live seats only.',
							},
						},
					},
					'A known key always answers 200, including a disabled one.',
				),
				...errors([
					['404', 'unknown_key — inconclusive, never a lockout.'],
					['422', 'invalid_key — inconclusive, never a lockout.'],
				]),
			},
		},
	},
	'/v1/deactivate': {
		post: {
			summary: 'Free a seat. Idempotent.',
			tags: ['Public'],
			requestBody: jsonBody(
				{
					type: 'object',
					required: ['license_key', 'instance_id'],
					properties: { license_key: { type: 'string' }, instance_id: { type: 'string' } },
				},
				'The key and the instance to release.',
			),
			responses: {
				200: jsonBody(
					{ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
					'Freed. An already-deactivated or unknown instance still answers ok.',
				),
			},
		},
	},
	'/v1/heartbeat': {
		post: {
			summary: 'Renew a floating lease',
			tags: ['Public'],
			requestBody: jsonBody(
				{
					type: 'object',
					required: ['license_key', 'instance_id'],
					properties: { license_key: { type: 'string' }, instance_id: { type: 'string' } },
				},
				'The key and the instance holding the seat.',
			),
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'lease_expires_at'],
						properties: {
							ok: { type: 'boolean' },
							lease_expires_at: {
								type: ['string', 'null'],
								description:
									'Null when nothing was renewed: unknown/deactivated instance, a lapsed lease with no free seat, or a node-locked product.',
							},
						},
					},
					'Lease state after the attempt.',
				),
			},
		},
	},
	'/v1/usage/increment': {
		post: {
			summary: 'Increment a metered counter, enforcing its quota atomically',
			tags: ['Public'],
			requestBody: jsonBody(
				{
					type: 'object',
					required: ['license_key', 'instance_id', 'metric'],
					properties: {
						license_key: { type: 'string' },
						instance_id: { type: 'string', description: 'Must be a live seat on this license.' },
						metric: { type: 'string', example: 'api_calls' },
						delta: { type: 'integer', minimum: 1, default: 1 },
					},
				},
				'Which key, which device, which metric.',
			),
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'current', 'limit', 'resets_at'],
						properties: {
							ok: { type: 'boolean' },
							current: { type: 'integer' },
							limit: { type: ['integer', 'null'] },
							resets_at: { type: ['string', 'null'] },
						},
					},
					'Counter state after the increment.',
				),
				...errors([
					['404', 'unknown_instance — not a live seat on this license.'],
					['429', 'quota_exceeded — carries the same counter fields as success.'],
				]),
			},
		},
	},
	'/v1/usage': {
		get: {
			summary: 'Current counters for a key',
			tags: ['Public'],
			parameters: [
				{ name: 'license_key', in: 'query', required: true, schema: { type: 'string' } },
			],
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'usage'],
						properties: {
							ok: { type: 'boolean' },
							usage: {
								type: 'array',
								items: {
									type: 'object',
									required: ['metric', 'current', 'limit', 'resets_at'],
									properties: {
										metric: { type: 'string' },
										current: { type: 'integer' },
										limit: { type: ['integer', 'null'] },
										resets_at: { type: ['string', 'null'] },
									},
								},
							},
						},
					},
					'Every counter on the license.',
				),
			},
		},
	},
	'/v1/pubkey': {
		get: {
			summary: 'Public signing keys for offline token verification (§11)',
			tags: ['Public'],
			parameters: [{ name: 'product', in: 'query', required: true, schema: { type: 'string' } }],
			responses: {
				200: jsonBody(
					{
						type: 'object',
						required: ['ok', 'algorithm', 'keys'],
						properties: {
							ok: { type: 'boolean' },
							algorithm: { type: 'string', enum: ['ed25519'] },
							keys: {
								type: 'object',
								additionalProperties: { type: 'string' },
								description: 'kid -> base64 public key. Retired keys stay for rotation safety.',
							},
						},
					},
					'The verification keyset for this product, including global keys.',
				),
			},
		},
	},
} as const;
