// ABOUTME: The uniform error envelope (PRD §9) — every error is { ok:false, error, message }.
// ABOUTME: ApiError carries an HTTP status + machine code; the app-level handler serializes it.

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ErrorBody {
	ok: false;
	error: string;
	message: string;
}

export class ApiError extends Error {
	constructor(
		readonly status: ContentfulStatusCode,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

// Public API error constructors (PRD §9).
export const invalidKey = () =>
	new ApiError(422, 'invalid_key', 'That license key is not in a valid format.');
export const unknownKey = () =>
	new ApiError(404, 'unknown_key', 'We could not find that license key.');
export const licenseDisabled = () =>
	new ApiError(403, 'license_disabled', 'This license has been disabled.');
export const activationLimitReached = (limit: number) =>
	new ApiError(
		409,
		'activation_limit_reached',
		`This license is already active on ${limit} device${limit === 1 ? '' : 's'}. Deactivate one from the customer portal to free a seat.`,
	);
export const quotaExceeded = () =>
	new ApiError(429, 'quota_exceeded', 'This usage quota has been reached.');
export const unauthorized = () =>
	new ApiError(401, 'unauthorized', 'A valid admin token is required.');
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);
export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);
export const validationError = (message: string) => new ApiError(422, 'validation_error', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

/** Serialize any thrown value to the uniform error envelope. */
export function toErrorResponse(c: Context, err: unknown): Response {
	if (err instanceof ApiError) {
		const body: ErrorBody = { ok: false, error: err.code, message: err.message };
		return c.json(body, err.status);
	}
	const body: ErrorBody = {
		ok: false,
		error: 'internal_error',
		message: 'Something went wrong on our end.',
	};
	return c.json(body, 500);
}
