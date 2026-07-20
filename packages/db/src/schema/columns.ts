// ABOUTME: Shared column helpers — one definition of how a timestamp default is written.
// ABOUTME: Every date in this schema is an ISO-8601 string compared lexicographically.

import { sql } from 'drizzle-orm';

/**
 * The default for a "when did this happen" column.
 *
 * Every date in this schema is stored as text and compared with `<` and `>` against
 * `new Date().toISOString()`, so the database default has to produce the *exact* same
 * shape or the comparison quietly means something else.
 *
 * `now()::text` is the obvious spelling and it is wrong: it yields
 * `2026-07-20 12:00:00.123456`, with a space instead of `T` and no `Z`. Since `' ' < 'T'`,
 * every defaulted row would sort before every application-written row forever. On
 * `provider_events.received_at` that alone would make the retention prune delete every
 * finished event immediately, silently weakening webhook idempotency.
 */
export const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
