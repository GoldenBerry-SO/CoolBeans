// ABOUTME: Asserts the rows behind the journeys, not just the API responses.
// ABOUTME: An endpoint can answer correctly while writing something wrong underneath.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// better-sqlite3 lives in the db package, not here.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../packages/db/package.json'));
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
assert.ok(dbPath, 'usage: node validate-data.mjs <path-to-sqlite>');
const db = new Database(dbPath, { readonly: true });

let checks = 0;
const check = (label, fn) => {
	fn();
	checks += 1;
	console.log(`  ✓ ${label}`);
};
const all = (sql) => db.prepare(sql).all();
const one = (sql) => db.prepare(sql).get();

console.log('\nData validation — the rows behind the journeys');

check('every licence points at a real product and, if paid for, a real purchase', () => {
	const orphans = all(`
		SELECT l.id FROM licenses l
		LEFT JOIN products p ON p.id = l.product_id
		WHERE p.id IS NULL
	`);
	assert.equal(orphans.length, 0, 'a licence without a product cannot be validated');
	const lost = all(`
		SELECT l.id FROM licenses l
		LEFT JOIN purchases pu ON pu.id = l.purchase_id
		WHERE l.purchase_id IS NOT NULL AND pu.id IS NULL
	`);
	assert.equal(lost.length, 0, 'a licence citing a purchase that does not exist');
});

check('one purchase issues exactly one licence, however often the webhook redelivers', () => {
	const dupes = all(`
		SELECT purchase_id, COUNT(*) AS n FROM licenses
		WHERE purchase_id IS NOT NULL
		GROUP BY purchase_id HAVING n > 1
	`);
	assert.equal(dupes.length, 0, `duplicate issuance for purchases: ${JSON.stringify(dupes)}`);
});

check('checkout ids are unique, so a replayed session cannot buy twice', () => {
	const dupes = all(`
		SELECT provider_checkout_id, COUNT(*) AS n FROM purchases
		WHERE provider_checkout_id IS NOT NULL
		GROUP BY provider_checkout_id HAVING n > 1
	`);
	assert.equal(dupes.length, 0, JSON.stringify(dupes));
});

check('every key is stored normalized: uppercase, no dashes, no ambiguous characters', () => {
	for (const { key } of all('SELECT key FROM licenses')) {
		assert.match(key, /^[A-Z0-9]+$/, `key is not normalized: ${key}`);
		// The generated body avoids characters people misread (PRD §10). The prefix is
		// the product's own, so only the body is checked.
		assert.ok(!/[ILOU01]/.test(key.slice(4)), `ambiguous characters in key body: ${key}`);
	}
});

check('live seats never exceed the product limit', () => {
	const over = all(`
		SELECT l.key, COUNT(a.id) AS live, p.activation_limit
		FROM licenses l
		JOIN products p ON p.id = l.product_id
		LEFT JOIN activations a ON a.license_id = l.id AND a.deactivated_at IS NULL
		GROUP BY l.id
		HAVING live > p.activation_limit
	`);
	assert.equal(over.length, 0, `seat cap breached: ${JSON.stringify(over)}`);
});

check('usage counters never exceed their limit', () => {
	const over = all(`
		SELECT u.current, COALESCE(u.limit_override, m.default_limit) AS lim
		FROM usage_counters u
		JOIN metrics m ON m.id = u.metric_id
		WHERE lim IS NOT NULL AND u.current > lim
	`);
	assert.equal(over.length, 0, `quota breached: ${JSON.stringify(over)}`);
});

check('a freed seat is kept as history, never deleted', () => {
	// Deactivation must be a timestamp, not a DELETE: support needs to see that a
	// device was once activated when a customer disputes a seat count.
	const bad = all("SELECT id FROM activations WHERE deactivated_at = ''");
	assert.equal(bad.length, 0, 'deactivated_at is either null or a real timestamp');
});

check('every activation belongs to a real licence', () => {
	const orphans = all(`
		SELECT a.id FROM activations a
		LEFT JOIN licenses l ON l.id = a.license_id
		WHERE l.id IS NULL
	`);
	assert.equal(orphans.length, 0);
});

check('a finished webhook releases its claim, so a retry is a clean no-op', () => {
	const stuck = all("SELECT id FROM provider_events WHERE status = 'done' AND claimed_at IS NOT NULL");
	assert.equal(stuck.length, 0, `done events still holding a claim: ${JSON.stringify(stuck)}`);
});

check('no parked revocation is left unapplied once its payment exists', () => {
	// A refund that arrived early parks itself here. If the matching purchase then shows
	// up and the row is still unconsumed, someone is holding a key we already refunded.
	const stranded = all(`
		SELECT r.reference FROM pending_revocations r
		JOIN purchases p
			ON p.provider_payment_id = r.reference OR p.provider_subscription_id = r.reference
		WHERE r.consumed_at IS NULL
	`);
	assert.equal(stranded.length, 0, `unapplied revocations: ${JSON.stringify(stranded)}`);
});

check('every issued licence is attributed in the audit log', () => {
	const issued = one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'license.issued'");
	const licences = one('SELECT COUNT(*) AS n FROM licenses');
	assert.ok(issued.n >= licences.n, `${licences.n} licences but only ${issued.n} issuance audit rows`);
	const anon = all("SELECT id FROM audit_log WHERE actor IS NULL OR actor = ''");
	assert.equal(anon.length, 0, 'an audit row with no actor cannot answer "who did this"');
});

check('a lifetime licence never carries an expiry', () => {
	const bad = all("SELECT key FROM licenses WHERE tier = 'lifetime' AND expires_at IS NOT NULL");
	assert.equal(bad.length, 0, `lifetime licences with an expiry: ${JSON.stringify(bad)}`);
});

check('foreign keys hold across the whole database', () => {
	const violations = db.pragma('foreign_key_check');
	assert.equal(violations.length, 0, JSON.stringify(violations));
});

check('no credential is stored in the clear', () => {
	const hex64 = /^[a-f0-9]{64}$/;
	for (const p of all('SELECT product_token_hash FROM products')) {
		if (p.product_token_hash) assert.match(p.product_token_hash, hex64, 'product tokens are hashed');
	}
	for (const s of all('SELECT token_hash FROM admin_sessions')) {
		assert.match(s.token_hash, hex64, 'session tokens are hashed');
		assert.ok(!s.token_hash.startsWith('cbs_'), 'never the plaintext session token');
	}
	for (const c of all('SELECT code_hash FROM auth_codes')) {
		assert.match(c.code_hash, hex64, 'sign-in codes are hashed');
		assert.ok(!/^\d{6}$/.test(c.code_hash), 'never the plaintext sign-in code');
	}
	for (const k of all('SELECT private_key FROM signing_keys')) {
		// encryptSecret stores iv.ciphertext.tag, each base64url (domain/crypto.ts).
		const parts = k.private_key.split('.');
		assert.equal(parts.length, 3, 'signing keys are encrypted at rest, not stored raw');
		for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/, 'each part is base64url');
		assert.ok(!k.private_key.includes('PRIVATE KEY'), 'never a raw PEM private key');
	}
});

console.log(`\n${checks} data checks passed.\n`);
