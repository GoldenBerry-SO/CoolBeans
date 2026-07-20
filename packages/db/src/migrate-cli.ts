// ABOUTME: Standalone migration entrypoint — the k8s Sync-hook Job and compose both run this.
// ABOUTME: Exits non-zero on failure so a bad migration blocks the rollout instead of half-applying.

import { createDb, createPool, migrate } from './index.js';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required');
	process.exit(1);
}

// max 1: migrations must never interleave with themselves through a pool.
const client = createPool(url, { max: 1 });
try {
	// Two Jobs racing (a retried deploy, or a Job beside a MIGRATE_ON_BOOT self-hoster)
	// must not both run DDL. The advisory lock serialises them server-side, and is held by
	// this session until it ends — which is exactly the lifetime of the process. Do not
	// rely on the migrator's own locking; it has varied across drizzle versions.
	await client`SELECT pg_advisory_lock(hashtext('coolbeans_migrations'))`;
	await migrate(createDb(client));
	console.log('migrations applied');
} catch (err) {
	console.error('migration failed', err);
	process.exitCode = 1;
} finally {
	await client.end({ timeout: 5 });
}
