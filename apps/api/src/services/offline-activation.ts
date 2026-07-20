// ABOUTME: Vendor-mediated activation for machines that will never reach us (issue #57).
// ABOUTME: The seat goes through the normal activate path, so this cannot dodge the cap.

import type { License, Product } from '@coolbeans/db';
import type { AppDeps } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { activate } from './licensing.js';
import { mintToken } from './signing.js';

export interface OfflineActivation {
	token: string;
	instanceId: string;
	license: License;
	product: Product;
}

/**
 * Mint a signed activation for a machine that cannot talk to us.
 *
 * The customer's air-gapped device shows a fingerprint; the vendor pastes it here and
 * hands the resulting token back by whatever means they like. The device never makes a
 * request, so nothing about this flow is initiated by it.
 *
 * Deliberately built on top of the ordinary `activate` path rather than beside it. That
 * gives the seat cap, the disabled check and the licence resolution exactly as the public
 * endpoint has them — this must not become a quiet way around the activation limit.
 *
 * The token gets a much longer TTL than a normal one because the machine can never
 * refresh, and mintToken clamps it to the licence's own expiry so a year-long token
 * cannot outlive what the customer paid for.
 */
export function issueOfflineActivation(
	deps: AppDeps,
	args: { keyInput: string; fingerprint: string; actor: string },
): OfflineActivation {
	// Naming the seat after the fingerprint is what makes it recognisable in the console:
	// an operator looking at the activation list can tell which machine it belongs to.
	const { license, product, activation, displayKey } = activate(
		deps,
		args.keyInput,
		`offline:${args.fingerprint}`,
	);

	const token = mintToken(deps, {
		license,
		product,
		instanceId: activation.instanceId,
		displayKey,
		ttlDays: deps.config.offlineActivationTtlDays,
	});

	// The one activation a customer never performs themselves, so the operator who did it
	// belongs on the record along with the machine it was for.
	writeAudit(deps.db, {
		action: 'activation.offline_issued',
		actor: args.actor,
		accountId: product.accountId,
		productId: product.id,
		licenseId: license.id,
		detail: { fingerprint: args.fingerprint, instance_id: activation.instanceId },
	});

	return { token, instanceId: activation.instanceId, license, product };
}
