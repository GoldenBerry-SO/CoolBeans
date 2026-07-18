// ABOUTME: Response serializers for the frozen §9 contract — the license and instance objects.
// ABOUTME: The license `key` is rendered back to display form; storage keeps it normalized.

import type { Activation, License, Product } from '@coolbeans/db';
import { toDisplayKey } from '../domain/keygen.js';

export interface LicenseObject {
	key: string;
	status: 'active' | 'disabled';
	tier: 'lifetime' | 'yearly' | 'trial';
	product: string;
	expires_at: string | null;
}

export interface InstanceObject {
	id: string;
	name: string;
}

/**
 * The §9 license object, identical wherever it appears. `effectiveStatus` lets callers
 * present a lazily-expired trial as disabled without mutating the row first.
 */
export function serializeLicense(
	license: License,
	product: Product,
	effectiveStatus?: 'active' | 'disabled',
): LicenseObject {
	return {
		key: toDisplayKey(license.key, product.keyPrefix),
		status: effectiveStatus ?? license.status,
		tier: license.tier,
		product: product.slug,
		expires_at: license.expiresAt ?? null,
	};
}

export function serializeInstance(activation: Activation): InstanceObject {
	return { id: activation.instanceId, name: activation.name };
}
