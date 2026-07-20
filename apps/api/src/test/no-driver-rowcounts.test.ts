// ABOUTME: Source scan forbidding driver rowcount reads — the sharpest trap in the Postgres port.
// ABOUTME: Every guarded statement must read RETURNING rows via applied()/affected(), never a count field.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Why a source scan and not the type checker: `Database` deliberately widens the driver's
 * raw result type so PGlite (tests) and postgres-js (production) share one seam, which
 * means `db.execute()` returns an untyped result and `.changes` on it compiles cleanly.
 * At runtime it is `undefined`, `undefined === 0` is false, and the cap that read it
 * silently stops being enforced — no error, no log, licences quietly unlimited. This test
 * is the tripwire the type system can no longer be.
 *
 * `.rowCount` (node-postgres) and `.rowsAffected` (libSQL) and `.affectedRows` (PGlite)
 * are banned for the same reason: a count field is whichever driver's spelling, and code
 * that reads one stops working the day the driver changes.
 */
const BANNED = /\.(changes|rowCount|rowsAffected|affectedRows)\b/;

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
	}
	return out;
}

describe('no driver rowcounts', () => {
	it('no production source reads a driver rowcount field', () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC_ROOT)) {
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				// Comments may (and do) mention the fields by name to explain this rule.
				const code = line.split('//')[0];
				if (BANNED.test(code)) offenders.push(`${file.slice(SRC_ROOT.length)}:${i + 1}`);
			});
		}
		expect(offenders, 'add RETURNING and use applied()/affected() from @coolbeans/db').toEqual([]);
	});
});
