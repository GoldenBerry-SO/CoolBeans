// ABOUTME: Global setup for the race suite — a real postgres:16-alpine container, migrated once.
// ABOUTME: PGlite is single-connection and cannot interleave; contention is this suite's whole point.

import { execSync } from 'node:child_process';
import { createDb, createPool, migrate } from '@coolbeans/db';
import type { TestProject } from 'vitest/node';

const NAME = 'coolbeans-pg-race';
const PORT = Number(process.env.RACE_PG_PORT ?? 55433);
const URL = `postgres://postgres:beans@localhost:${PORT}/coolbeans`;

/**
 * Same container recipe as scripts/postgres/atomicity.sh, and deliberately Postgres 16:
 * the shared GoldenBerry cluster runs 16, and a race suite proving MVCC behaviour on a
 * different major version would be an oracle for the wrong database.
 */
export default async function setup(project: TestProject) {
	execSync(`docker rm -f ${NAME} >/dev/null 2>&1 || true`, { shell: '/bin/bash' });
	execSync(
		`docker run -d --rm --name ${NAME} -e POSTGRES_PASSWORD=beans -e POSTGRES_DB=coolbeans -p ${PORT}:5432 postgres:16-alpine`,
		{ stdio: 'ignore' },
	);

	// pg_isready reports the socket before the TCP listener actually serves; poll a real
	// query instead (same lesson atomicity.sh already recorded).
	const probe = createPool(URL, { max: 1 });
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			await probe`select 1`;
			break;
		} catch {
			if (Date.now() > deadline) throw new Error('race-suite Postgres never became ready');
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	await migrate(createDb(probe));
	await probe.end({ timeout: 5 });

	project.provide('racePgUrl', URL);

	return async () => {
		execSync(`docker rm -f ${NAME} >/dev/null 2>&1 || true`, { shell: '/bin/bash' });
	};
}

declare module 'vitest' {
	export interface ProvidedContext {
		racePgUrl: string;
	}
}
