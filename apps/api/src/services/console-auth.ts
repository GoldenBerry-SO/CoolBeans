// ABOUTME: Console magic-code auth (PRD §16) — email a six-digit code, verify it, mint a session.
// ABOUTME: The first-ever sign-in creates the account (bootstrap); after that only known admins get codes.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { AdminUser } from '@coolbeans/db';
import { adminSessions, adminUsers, authCodes } from '@coolbeans/db';
import { MagicCodeEmail, render } from '@coolbeans/email';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function hashesEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left, 'hex');
	const rightBytes = Buffer.from(right, 'hex');
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export interface RequestCodeResult {
	/** Always true toward the client (no enumeration); false only means "nothing was sent". */
	sent: boolean;
}

/**
 * Request a sign-in code. Sends only when the email belongs to an admin, OR when no
 * admin exists yet (first sign-in bootstraps the account — the "create account" flow).
 * Returns the same success either way so the endpoint never reveals whether an email exists.
 */
export async function requestCode(deps: AppDeps, emailInput: string): Promise<RequestCodeResult> {
	const email = normalizeEmail(emailInput);
	const anyAdmin = deps.db.select({ id: adminUsers.id }).from(adminUsers).limit(1).get();
	const known = deps.db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
	if (anyAdmin && !known) return { sent: false };
	// Delivery is optional when codes are being logged for local development — that setup
	// has no Resend key and no SMTP, and bailing here would mean nobody can sign in.
	if (!deps.email && !deps.config.logMagicCodes) {
		deps.logger.error('Console auth: no email sender configured; cannot deliver codes');
		return { sent: false };
	}

	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const now = nowDate(deps);
	deps.db
		.insert(authCodes)
		.values({
			email,
			codeHash: sha256(code),
			expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(),
		})
		.run();

	if (deps.config.logMagicCodes) {
		// Local development only (see Config.logMagicCodes): saves digging through a mail
		// catcher to sign in. Refused in production at config load.
		deps.logger.warn('Console magic code (development logging is on)', { email, code });
	}

	if (deps.email) {
		const html = await render(MagicCodeEmail({ code, expiresMinutes: CODE_TTL_MINUTES }));
		await deps.email.send({
			from: 'Cool Beans <console@coolbeans.tools>',
			to: email,
			subject: `${code} is your Cool Beans sign-in code`,
			html,
		});
	}
	return { sent: true };
}

export interface VerifyCodeResult {
	token: string;
	admin: { email: string; name: string | null };
}

/** Verify a code and mint a session token (returned once; only its hash is stored). */
export function verifyCode(
	deps: AppDeps,
	emailInput: string,
	code: string,
	name?: string,
): VerifyCodeResult | null {
	const email = normalizeEmail(emailInput);
	const now = nowDate(deps);
	const nowIso = now.toISOString();

	return deps.db.transaction((tx): VerifyCodeResult | null => {
		const candidate = tx
			.select()
			.from(authCodes)
			.where(
				and(
					eq(authCodes.email, email),
					isNull(authCodes.consumedAt),
					gt(authCodes.expiresAt, nowIso),
					lt(authCodes.attempts, MAX_CODE_ATTEMPTS),
				),
			)
			.orderBy(sql`${authCodes.id} DESC`)
			.get();
		if (!candidate) return null;

		const codeHash = sha256(code);
		if (!hashesEqual(candidate.codeHash, codeHash)) {
			// Increment from the stored value under a guard. Concurrent guesses cannot all
			// overwrite the same stale attempts+1 value or push beyond the cap.
			tx.update(authCodes)
				.set({ attempts: sql`${authCodes.attempts} + 1` })
				.where(
					and(
						eq(authCodes.id, candidate.id),
						isNull(authCodes.consumedAt),
						gt(authCodes.expiresAt, nowIso),
						lt(authCodes.attempts, MAX_CODE_ATTEMPTS),
					),
				)
				.run();
			return null;
		}

		// Consume with all validity checks in the UPDATE itself. Only one verifier can
		// receive the row and continue to mint a session, even across server replicas.
		const consumed = tx
			.update(authCodes)
			.set({ consumedAt: nowIso })
			.where(
				and(
					eq(authCodes.id, candidate.id),
					eq(authCodes.codeHash, codeHash),
					isNull(authCodes.consumedAt),
					gt(authCodes.expiresAt, nowIso),
					lt(authCodes.attempts, MAX_CODE_ATTEMPTS),
				),
			)
			.returning({ id: authCodes.id })
			.get();
		if (!consumed) return null;

		let admin = tx.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
		if (!admin) {
			// Recheck bootstrap eligibility at verification time. Two emails can request a
			// code while the table is empty; once one creates the first admin, the other must
			// not silently bootstrap a second, unrelated account.
			const anyAdmin = tx.select({ id: adminUsers.id }).from(adminUsers).limit(1).get();
			if (anyAdmin) return null;
			admin = tx
				.insert(adminUsers)
				.values({ email, name: name ?? null })
				.returning()
				.get();
			writeAudit(tx, { action: 'admin.created', actor: `admin:${email}` });
		}
		tx.update(adminUsers)
			.set({ lastLoginAt: nowIso, ...(name ? { name } : {}) })
			.where(eq(adminUsers.id, admin.id))
			.run();

		const token = `cbs_${randomBytes(24).toString('hex')}`;
		tx.insert(adminSessions)
			.values({
				tokenHash: sha256(token),
				adminUserId: admin.id,
				expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString(),
			})
			.run();
		writeAudit(tx, { action: 'admin.signed_in', actor: `admin:${email}` });

		return { token, admin: { email: admin.email, name: name ?? admin.name } };
	});
}

/** Resolve a session token to its admin, or undefined when absent/expired. */
export function adminForSession(deps: AppDeps, token: string): AdminUser | undefined {
	if (!token.startsWith('cbs_')) return undefined;
	const nowIso = nowDate(deps).toISOString();
	const row = deps.db
		.select({ admin: adminUsers })
		.from(adminSessions)
		.innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
		.where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, nowIso)))
		.get();
	return row?.admin;
}

/** Revoke a session (sign out). Idempotent. */
export function revokeSession(deps: AppDeps, token: string): void {
	deps.db
		.delete(adminSessions)
		.where(eq(adminSessions.tokenHash, sha256(token)))
		.run();
}

export interface TeamMember {
	id: number;
	email: string;
	name: string | null;
	createdAt: string;
	lastLoginAt: string | null;
}

/** Everyone who can sign in to the console. Never exposes session material. */
export function listTeam(deps: AppDeps): TeamMember[] {
	return deps.db
		.select({
			id: adminUsers.id,
			email: adminUsers.email,
			name: adminUsers.name,
			createdAt: adminUsers.createdAt,
			lastLoginAt: adminUsers.lastLoginAt,
		})
		.from(adminUsers)
		.orderBy(adminUsers.id)
		.all();
}

/**
 * Add an admin so they can request a sign-in code. Idempotent: inviting an existing
 * member returns them unchanged rather than erroring, so a double-click is harmless.
 */
export function inviteAdmin(
	deps: AppDeps,
	emailInput: string,
	actor: string,
	name?: string,
): TeamMember {
	const email = normalizeEmail(emailInput);
	const existing = deps.db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
	if (existing) {
		return {
			id: existing.id,
			email: existing.email,
			name: existing.name,
			createdAt: existing.createdAt,
			lastLoginAt: existing.lastLoginAt,
		};
	}
	const created = deps.db
		.insert(adminUsers)
		.values({ email, name: name ?? null })
		.returning()
		.get();
	writeAudit(deps.db, { action: 'admin.invited', actor, detail: { email } });
	return {
		id: created.id,
		email: created.email,
		name: created.name,
		createdAt: created.createdAt,
		lastLoginAt: created.lastLoginAt,
	};
}

export type RevokeResult = 'revoked' | 'not_found' | 'last_admin';

/**
 * Remove an admin and drop their live sessions in the same breath — a revoked admin
 * must lose access now, not whenever their 30-day session happens to expire.
 * The last admin is never removable: that would lock the console out entirely.
 */
export function revokeAdmin(deps: AppDeps, id: number, actor: string): RevokeResult {
	return deps.db.transaction((tx): RevokeResult => {
		const target = tx.select().from(adminUsers).where(eq(adminUsers.id, id)).get();
		if (!target) return 'not_found';
		const total = tx.select({ id: adminUsers.id }).from(adminUsers).all().length;
		if (total <= 1) return 'last_admin';

		tx.delete(adminSessions).where(eq(adminSessions.adminUserId, id)).run();
		tx.delete(adminUsers).where(eq(adminUsers.id, id)).run();
		// Pending codes would otherwise let them sign straight back in.
		tx.delete(authCodes).where(eq(authCodes.email, target.email)).run();
		writeAudit(tx, { action: 'admin.revoked', actor, detail: { email: target.email } });
		return 'revoked';
	});
}
