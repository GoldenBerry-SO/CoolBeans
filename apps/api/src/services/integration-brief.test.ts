// ABOUTME: The agent guide + product brief (#64) carry the frozen contract and real config,
// ABOUTME: gate the heartbeat on seat model, and never leak a secret. This pins that contract.

import { describe, expect, it } from 'vitest';
import { type BriefProduct, buildAgentGuide, buildProductBrief } from './integration-brief.js';

function product(overrides: Partial<BriefProduct> = {}): BriefProduct {
	return {
		slug: 'acme-app',
		name: 'Acme App',
		keyPrefix: 'ACME',
		activationModel: 'node_locked',
		activationLimit: 3,
		...overrides,
	};
}

const BASE = 'https://app.coolbeans.tools';
const GUIDE = `${BASE}/v1/llms.txt`;
const KEYS = { '1': 'MCowBQYDK2VwAyEA_fakekey_' };

describe('buildAgentGuide', () => {
	const guide = buildAgentGuide();

	it('states the offline contract that must never be broken', () => {
		expect(guide).toContain('404');
		expect(guide).toMatch(/disabled/i);
		expect(guide).toMatch(/never lock/i);
	});

	it('frames the whole thing as the one call, from the first paragraph', () => {
		// The opening used to say "your app activates a key, then validates it", and the one rule
		// ended with "fall back to offline verification" — both instructions to do work the SDK now
		// does. An agent reads the top of a document hardest, so a stale frame there outweighs the
		// correct code further down, and sends it looking for a method the guide no longer names.
		const opening = guide.slice(0, guide.indexOf('## Install'));
		expect(opening).toMatch(/one call|open\(/);
		expect(opening).toContain('decision');
		expect(guide).not.toMatch(/fall back to offline|fall back to `?verifyOffline/i);
	});

	it('documents the public endpoints and both SDK installs', () => {
		for (const path of ['/v1/activate', '/v1/validate', '/v1/heartbeat', '/v1/pubkey']) {
			expect(guide, path).toContain(path);
		}
		expect(guide).toContain('npm i @coolbeans/sdk');
		expect(guide).toContain('coolbeans-swift');
	});

	it('explains both seat models', () => {
		expect(guide).toMatch(/per device|node-locked/i);
		expect(guide).toMatch(/concurrent|floating/i);
	});

	it('teaches the one call in both languages, not one of them (#77)', () => {
		const swift = guide.slice(guide.indexOf('```swift'));
		expect(swift).toContain('cb.open(');
		expect(swift).toContain('decision');
		// The Swift SDK holds a floating seat itself now, so neither language is told to schedule
		// anything. An app-side interval was the same footgun in both.
		expect(guide.toLowerCase()).not.toContain('holdseat');
	});

	it('teaches the one-call shape, and nothing that no longer exists (#75)', () => {
		expect(guide).toContain('open(');
		expect(guide).toContain('decision');
		// start({ heartbeatMs }) is gone: the SDK holds a floating seat on the cadence the
		// server's own lease implies. A guide naming a deleted method sends a coding agent off
		// to write code that throws, which is worse than saying nothing.
		expect(guide).not.toContain('cb.start(');
		expect(guide).not.toContain('heartbeatMs');
	});

	it('gives the brief the same one instruction, since that is what an agent follows', () => {
		// Found by reading the rendered brief rather than the builder: its "Do this" section still
		// said "activate-on-key-entry, verify-offline-on-launch" — the exact ceremony the guide had
		// stopped teaching. The brief is the document with the real values in it, so it is the one
		// an agent acts on.
		for (const model of ['node_locked', 'floating'] as const) {
			const brief = buildProductBrief({
				product: product({ activationModel: model }),
				baseUrl: BASE,
				publicKeys: KEYS,
				guideUrl: GUIDE,
			});
			expect(brief, model).toContain('open(');
			expect(brief, model).toMatch(/decision/);
			expect(brief, model).not.toMatch(/verify-offline|verifyOffline|activate-on-key-entry/);
		}
	});

	it('teaches one path and none of the ceremony that path removed (#78)', () => {
		// An agent reading this wires up a real customer's app. Every extra way to do it is a
		// way to get it wrong, and each of these was a real lockout: choosing verifyOffline over
		// verify, keeping an instance id, picking a heartbeat interval.
		expect(guide).not.toMatch(/verifyOffline|offlineState/);
		expect(guide).not.toMatch(/instanceId|instance_id: *<|\{ instanceId \}/);
		expect(guide).not.toMatch(/heartbeat\(|heartbeatMs|every \d+ minutes/);
		// One deny check is the whole app-side decision.
		expect(guide).toContain("state.decision === 'deny'");
	});

	it('supplies storage an app can actually paste, not just a warning about it', () => {
		// The SDK refuses to construct without durable storage outside a browser. An agent given
		// only a comment writes the throwing version, and the likeliest real-world lockout is a
		// desktop app that quietly re-activates on every restart until the licence is used up.
		expect(guide).toMatch(/getItem/);
		expect(guide).toMatch(/setItem/);
		expect(guide).toMatch(/writeFileSync|electron-store|readFileSync/);
	});

	it('does not tell an app to read a seat count that does not exist', () => {
		// Three separate reviews flagged this: the docs said "read the seat count off the licence"
		// and there is no seat field on the licence or the verdict. An instruction nobody can
		// follow gets guessed at, and a guessed seat policy in an app is worse than none.
		expect(guide).not.toMatch(/seat counts?[^.]*off the licence|read the count off the licence/i);
		expect(guide).toMatch(/enforced (on the server|server-side)/i);
	});

	it('tells an app to pass the product slug, and why it matters', () => {
		// An app that declares no slug is bound by the first licence it activates. For a vendor
		// selling two products that is one unchecked key: a customer holding a licence for the
		// other app could paste it into a fresh install and unlock this one. So the guide asks for
		// it unconditionally and explains the single case where omitting it is safe.
		expect(guide).toMatch(/always pass `product`/i);
		expect(guide).toMatch(/exactly one product/i);
		expect(guide).toContain("product: '<your-product-slug>'");
	});

	it('puts seats on the server and capabilities on the licence (#78)', () => {
		// The earlier wording told an app to read a seat count off the licence, which no field
		// supports. Seats only ever reach an app as a deny it already handles; capabilities are
		// the thing that genuinely varies per licence.
		expect(guide).toMatch(/never counts them|enforced on the server/i);
		expect(guide).toMatch(/state\.entitlements/);
	});

	it('answers the questions an integrator actually asks', () => {
		// Each of these came back from handing the guide to an engineer with no other context and
		// reading what they had to guess at.
		// What a capability value can be, since they write `entitlements?.x` against it:
		const heading = '## Gating features';
		const gating = guide.slice(guide.indexOf(heading) + heading.length);
		expect(gating.slice(0, gating.indexOf('\n## '))).toMatch(/booleans, numbers/i);
		// What release() leaves behind, since a half-signed-out app is a support ticket:
		const release = guide.slice(guide.indexOf('- `release()`'));
		expect(release.slice(0, release.indexOf('\n- '))).toMatch(/refresh|upkeep/i);
	});

	it('documents entitlements in the verdict it tells you to read them from', () => {
		// The verdict block listed decision, reason, license and expiresAt, then a later section
		// said to gate on state.entitlements. An integrator has to assume where that lives.
		const verdict = guide.slice(guide.indexOf('The verdict:'));
		const firstFence = verdict.indexOf('```');
		expect(verdict.slice(firstFence, verdict.indexOf('```', firstFence + 3))).toContain(
			'entitlements',
		);
	});

	it('says how to tell a user their key was refused', () => {
		// open() swallows the reason on purpose — an unknown key is inconclusive and must never
		// revoke — but that left an integrator with no way to write "we could not verify that key",
		// which is the most common thing a key form has to say. activate() is that path.
		expect(guide).toMatch(/activate\(/);
		const surface = guide.slice(guide.indexOf('## The whole surface'));
		expect(surface).toMatch(/key-entry|why a key was refused|refused/i);
	});

	it('leaks no pricing or plumbing, in the guide or a brief (#78)', () => {
		const brief = buildProductBrief({
			product: product({ activationModel: 'floating' }),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		for (const text of [guide, brief]) {
			// Price ids, grant ids, connection ids and Stripe account ids are ours and the
			// vendor's business. An app never needs one, so it never sees one.
			expect(text).not.toMatch(/price_[A-Za-z0-9]/);
			expect(text).not.toMatch(/acct_[A-Za-z0-9]/);
			expect(text).not.toMatch(/grant[_ ]id|stripe_connection|connection[_ ]id/i);
		}
	});

	it('points feature gating at signed entitlements, never at plan or kind (#76)', () => {
		expect(guide).toContain('entitlements');
		const gating = guide.slice(guide.indexOf('entitlements'));
		// The distinction is the whole safety argument: plan is a label a vendor types, and
		// entitlements are server-authored and signed. A guide that blurs it teaches an agent to
		// ship `if (plan === 'Pro')`, which breaks the moment a vendor renames a tier.
		expect(gating).toMatch(/signed/i);
		expect(guide).toMatch(/never branch|display only|never gate/i);
	});

	it('tells a TypeScript app it has no seat scheduling to do (#75)', () => {
		const floatingAdvice = guide.slice(guide.toLowerCase().indexOf('seat model'));
		expect(floatingAdvice).toMatch(/the SDK|itself|on its own/i);
	});
});

describe('buildProductBrief', () => {
	it('pre-fills the real config and links to the guide', () => {
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(brief).toContain('acme-app');
		expect(brief).toContain('ACME');
		expect(brief).toContain(BASE);
		expect(brief).toContain(GUIDE);
	});

	it('embeds the public keys with their kid', () => {
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(brief).toContain('"1"');
		expect(brief).toContain('MCowBQYDK2VwAyEA_fakekey_');
	});

	it('names the capabilities this product actually grants, so nobody guesses', () => {
		// The guide says never invent an entitlement name and hope the vendor set it. That is only
		// actionable if the brief lists the real ones, and an absent name fails silently: the
		// feature is simply off, with no error anywhere to notice.
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
			entitlementNames: ['export_4k', 'batch_limit'],
		});
		expect(brief).toContain('export_4k');
		expect(brief).toContain('batch_limit');
		expect(brief).toMatch(/state\.entitlements/);
	});

	it('says plainly when a product grants no capabilities at all', () => {
		// Silence here reads as "the brief forgot", and an agent then invents a name.
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
			entitlementNames: [],
		});
		expect(brief).toMatch(/no capabilit/i);
		expect(brief).not.toMatch(/export_4k/);
	});

	it('explains how keys arrive when none exist yet, so an early integration still works', () => {
		// Keys are minted on the first token, so a brand-new product has none. The brief has to
		// say the SDK fetches them itself rather than leaving an empty block that reads broken.
		const brief = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: {},
			guideUrl: GUIDE,
		});
		expect(brief).toContain('/v1/keyset');
		expect(brief.toLowerCase()).toContain('first `open()`');
		// The slug route still gets a mention for an integration that has a slug.
		expect(brief).toContain('/v1/pubkey?product=acme-app');
	});

	it('lists the heartbeat endpoint only for a floating product, and tells nobody to call it', () => {
		// The endpoint list is for an integration writing raw HTTP, so a floating product needs it
		// there. A TypeScript app must still be told the SDK holds the seat: the same word means
		// "here is the route" in one section and "your job" in the other, and only one is true.
		const locked = buildProductBrief({
			product: product(),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(locked.toLowerCase()).not.toContain('/v1/heartbeat');
		expect(locked).toMatch(/nothing to do/i);

		const floating = buildProductBrief({
			product: product({ activationModel: 'floating' }),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		expect(floating).toContain('/v1/heartbeat');
		expect(floating).toMatch(/SDK holds the seat/i);
		expect(floating).toMatch(/do not write a heartbeat/i);
	});

	it('never leaks a service secret: only public config appears', () => {
		const brief = buildProductBrief({
			product: product({ activationModel: 'floating' }),
			baseUrl: BASE,
			publicKeys: KEYS,
			guideUrl: GUIDE,
		});
		// No API keys, webhook secrets, or bearer tokens: the license key is the credential.
		expect(brief).not.toMatch(/sk_|whsec_|Bearer |ADMIN_TOKEN/);
	});
});
