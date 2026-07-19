// ABOUTME: Console magic-code auth (PRD §16) — email a six-digit code, verify it, mint a session.
// ABOUTME: The first-ever sign-in creates the account (bootstrap); after that only known admins get codes.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { AdminUser } from '@coolbeans/db';
import { accounts, adminSessions, adminUsers, authCodes } from '@coolbeans/db';
import { MagicCodeEmail, render } from '@coolbeans/email';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { AppDeps } from '../deps.js';
import { nowDate } from '../deps.js';
import { writeAudit } from '../store/audit.js';
import { isBillingEnabled } from './plan-limits.js';

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
 * Codes an address may have outstanding at once. Cloud mode will send to any valid
 * address, so without a per-email cap this endpoint is an open relay pointed at whoever
 * an attacker likes. The rate limiter on /auth/* bounds one caller; this bounds one
 * victim, however many callers ask.
 */
const MAX_LIVE_CODES_PER_EMAIL = 3;

/**
 * Request a sign-in code.
 *
 * Cloud (billing configured) sends to any valid address, because that is the public
 * signup flow. Self-host keeps the closed rule: only a known admin, or the very first
 * sign-in that bootstraps the instance. A self-hosted box should not let strangers create
 * accounts on it.
 *
 * Returns the same success either way so the endpoint never reveals whether an email exists.
 */
export async function requestCode(deps: AppDeps, emailInput: string): Promise<RequestCodeResult> {
	const email = normalizeEmail(emailInput);
	const known = deps.db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
	if (!known && !isBillingEnabled(deps)) {
		const anyAdmin = deps.db.select({ id: adminUsers.id }).from(adminUsers).limit(1).get();
		if (anyAdmin) return { sent: false };
	}
	const nowIso = nowDate(deps).toISOString();
	const live = deps.db
		.select({ id: authCodes.id })
		.from(authCodes)
		.where(
			and(
				eq(authCodes.email, email),
				isNull(authCodes.consumedAt),
				gt(authCodes.expiresAt, nowIso),
			),
		)
		.all().length;
	if (live >= MAX_LIVE_CODES_PER_EMAIL) {
		// Silent: saying "too many" would confirm the address is being targeted, and the
		// caller already gets the same uniform success.
		deps.logger.warn('Console auth: sign-in code cap reached for an address', { email });
		return { sent: false };
	}
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
	account: { id: number; name: string; plan: 'free' | 'pro' };
}

/** A sensible default account name from an email, e.g. chris@acme.com → acme.com. */
function accountNameFor(email: string): string {
	return email.split('@')[1] ?? email;
}

/** Verify a code and mint a session token (returned once; only its hash is stored). */
export function verifyCode(
	deps: AppDeps,
	emailInput: string,
	code: string,
	name?: string,
	accountName?: string,
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
			if (isBillingEnabled(deps)) {
				// Cloud signup: a new address gets its own account, on the free plan.
				const created = tx
					.insert(accounts)
					.values({ name: accountName ?? accountNameFor(email) })
					.returning()
					.get();
				admin = tx
					.insert(adminUsers)
					.values({ accountId: created.id, email, name: name ?? null })
					.returning()
					.get();
				writeAudit(tx, {
					action: 'account.created',
					actor: `admin:${email}`,
					accountId: created.id,
				});
				writeAudit(tx, {
					action: 'admin.created',
					actor: `admin:${email}`,
					accountId: created.id,
				});
			} else {
				// Self-host bootstrap. Rechecked at verification time because two emails can
				// request a code while the table is empty; once one creates the first admin,
				// the other must not silently bootstrap a second, unrelated account.
				const anyAdmin = tx.select({ id: adminUsers.id }).from(adminUsers).limit(1).get();
				if (anyAdmin) return null;
				admin = tx
					.insert(adminUsers)
					.values({ email, name: name ?? null })
					.returning()
					.get();
				writeAudit(tx, {
					action: 'admin.created',
					actor: `admin:${email}`,
					accountId: admin.accountId,
				});
			}
		}
		tx.update(adminUsers)
			.set({ lastLoginAt: nowIso, ...(name ? { name } : {}) })
			.where(eq(adminUsers.id, admin.id))
			.run();

		const token = `cbs_${randomBytes(24).toString('hex')}`;
		tx.insert(adminSessions)
			.values({
				tokenHash: sha256(token),
				// The tenant travels with the credential, so scoping reads the session.
				accountId: admin.accountId,
				adminUserId: admin.id,
				expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString(),
			})
			.run();
		writeAudit(tx, {
			action: 'admin.signed_in',
			actor: `admin:${email}`,
			accountId: admin.accountId,
		});

		const account = tx.select().from(accounts).where(eq(accounts.id, admin.accountId)).get();
		return {
			token,
			admin: { email: admin.email, name: name ?? admin.name },
			account: { id: admin.accountId, name: account?.name ?? '', plan: account?.plan ?? 'free' },
		};
	});
}

export interface SessionIdentity {
	admin: AdminUser;
	/**
	 * Read off the session rather than the admin, so the tenant travels with the
	 * credential. One human in two accounts later needs no change to the scoping code.
	 */
	accountId: number;
}

/** Resolve a session token to its admin and account, or undefined when absent/expired. */
export function adminForSession(deps: AppDeps, token: string): SessionIdentity | undefined {
	if (!token.startsWith('cbs_')) return undefined;
	const nowIso = nowDate(deps).toISOString();
	const row = deps.db
		.select({ admin: adminUsers, accountId: adminSessions.accountId })
		.from(adminSessions)
		.innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
		.where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, nowIso)))
		.get();
	return row ? { admin: row.admin, accountId: row.accountId } : undefined;
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

function toMember(row: AdminUser): TeamMember {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		createdAt: row.createdAt,
		lastLoginAt: row.lastLoginAt,
	};
}

/** Everyone in one account who can sign in to the console. Never exposes session material. */
export function listTeam(deps: AppDeps, accountId: number): TeamMember[] {
	return deps.db
		.select({
			id: adminUsers.id,
			email: adminUsers.email,
			name: adminUsers.name,
			createdAt: adminUsers.createdAt,
			lastLoginAt: adminUsers.lastLoginAt,
		})
		.from(adminUsers)
		.where(eq(adminUsers.accountId, accountId))
		.orderBy(adminUsers.id)
		.all();
}

/**
 * Add an admin to an account so they can request a sign-in code.
 *
 * Still idempotent within the account, so a double-click is harmless. Across accounts it
 * refuses: emails are globally unique, and returning the existing row would hand the
 * caller an admin whose sessions carry a different account id — a silent cross-tenant
 * takeover rather than an invitation.
 */
export function inviteAdmin(
	deps: AppDeps,
	accountId: number,
	emailInput: string,
	actor: string,
	name?: string,
): TeamMember | 'email_in_use' {
	const email = normalizeEmail(emailInput);
	const existing = deps.db.select().from(adminUsers).where(eq(adminUsers.email, email)).get();
	if (existing) {
		return existing.accountId === accountId ? toMember(existing) : 'email_in_use';
	}
	const created = deps.db
		.insert(adminUsers)
		.values({ accountId, email, name: name ?? null })
		.returning()
		.get();
	writeAudit(deps.db, { action: 'admin.invited', actor, accountId, detail: { email } });
	return toMember(created);
}

export type RevokeResult = 'revoked' | 'not_found' | 'last_admin';

/**
 * Remove an admin and drop their live sessions in the same breath — a revoked admin
 * must lose access now, not whenever their 30-day session happens to expire.
 *
 * The last admin *of the account* is never removable: that would lock that account out
 * of the console. Counting instance-wide instead would let one account's last admin be
 * removed as soon as any other account had two.
 */
export function revokeAdmin(
	deps: AppDeps,
	accountId: number,
	id: number,
	actor: string,
): RevokeResult {
	return deps.db.transaction((tx): RevokeResult => {
		const target = tx.select().from(adminUsers).where(eq(adminUsers.id, id)).get();
		// Another account's admin is "not found", not "forbidden": a 403 would confirm the
		// id exists somewhere else on the instance.
		if (!target || target.accountId !== accountId) return 'not_found';
		const total = tx
			.select({ id: adminUsers.id })
			.from(adminUsers)
			.where(eq(adminUsers.accountId, accountId))
			.all().length;
		if (total <= 1) return 'last_admin';

		tx.delete(adminSessions).where(eq(adminSessions.adminUserId, id)).run();
		tx.delete(adminUsers).where(eq(adminUsers.id, id)).run();
		// Pending codes would otherwise let them sign straight back in.
		tx.delete(authCodes).where(eq(authCodes.email, target.email)).run();
		writeAudit(tx, { action: 'admin.revoked', actor, accountId, detail: { email: target.email } });
		return 'revoked';
	});
}
