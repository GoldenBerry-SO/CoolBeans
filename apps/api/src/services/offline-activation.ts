// ABOUTME: Vendor-mediated activation for machines that will never reach us (issue #57).
// ABOUTME: The seat goes through the normal activate path, so this cannot dodge the cap.

import type { License, Product } from '@coolbeans/db';
import type { AppDeps } from '../deps.js';
import { conflict } from '../http/errors.js';
import { writeAudit } from '../store/audit.js';
import { activate, resolveLicense } from './licensing.js';
import { mintToken } from './signing.js';

export interface OfflineActivation {
	token: string;
	instanceId: string;
	/**
	 * When this activation stops working, which is the TTL clamped by the licence expiry.
	 * Not the licence's own expiry: a lifetime licence has none, and its blob still dies at
	 * the TTL, so reporting the licence would tell an operator the machine is good forever.
	 */
	expiresAt: string;
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
export async function issueOfflineActivation(
	deps: AppDeps,
	args: { keyInput: string; fingerprint: string; actor: string },
): Promise<OfflineActivation> {
	// Naming the seat after the fingerprint is what makes it recognisable in the console:
	// an operator looking at the activation list can tell which machine it belongs to.
	// Floating is refused outright, not adapted. A floating seat is held by a lease the
	// machine renews; an air-gapped machine can never heartbeat, so its lease lapses, the
	// server frees the seat, and an operator can mint unlimited air-gapped tokens while
	// every earlier machine stays unlocked for a year. Offline activation is inherently
	// node-locked, and pretending otherwise would quietly void the activation limit.
	const target = await resolveLicense(deps, args.keyInput);
	if (target.product.activationModel === 'floating') {
		throw conflict(
			'floating_not_supported',
			'Offline activation needs a node-locked product. A floating seat is held by a lease the machine has to renew, which an offline machine can never do.',
		);
	}

	const { license, product, activation, displayKey } = await activate(
		deps,
		args.keyInput,
		`offline:${args.fingerprint}`,
	);

	const { token, payload } = await mintToken(deps, {
		license,
		product,
		instanceId: activation.instanceId,
		displayKey,
		offline: {
			ttlDays: deps.config.offlineActivationTtlDays,
			// The only thing tying this blob to one machine. Without it a client can merely
			// compare the token to the instance id the token itself supplied.
			fingerprint: args.fingerprint,
		},
	});

	// The one activation a customer never performs themselves, so the operator who did it
	// belongs on the record along with the machine it was for.
	await writeAudit(deps.db, {
		action: 'activation.offline_issued',
		actor: args.actor,
		accountId: product.accountId,
		productId: product.id,
		licenseId: license.id,
		detail: { fingerprint: args.fingerprint, instance_id: activation.instanceId },
	});

	return {
		token,
		instanceId: activation.instanceId,
		expiresAt: new Date(payload.exp * 1000).toISOString(),
		license,
		product,
	};
}
