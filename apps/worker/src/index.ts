// ABOUTME: Background job processor (PRD §14, §30) — BullMQ over Redis, mirroring pleasehold's worker.
// ABOUTME: Drains the durable outbox and runs periodic sweeps; the outbox is the source of truth.

import {
	type AppDeps,
	drainOutbox,
	loadConfig,
	resolveEmailSender,
	runSweeps,
} from '@coolbeans/api/runtime';
import { assertSchemaCurrent, createDb, createPool } from '@coolbeans/db';
import { createLogger } from '@coolbeans/logger';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const logger = createLogger();
const config = loadConfig();

if (!config.redisUrl) {
	logger.error('Worker requires REDIS_URL');
	process.exit(1);
}

if (!config.databaseUrl.startsWith('postgres')) {
	logger.error(
		'DATABASE_URL must be a postgres:// URL. Cool Beans runs on PostgreSQL; docker compose provides one for self-hosting (see README).',
	);
	process.exit(1);
}
const db = createDb(createPool(config.databaseUrl));

// The worker never migrates, not even with MIGRATE_ON_BOOT: it always runs beside an API
// process, so "single-process self-host" can never describe it. It only refuses to start
// against a schema it does not understand.
try {
	await assertSchemaCurrent(db);
} catch (err) {
	logger.error('Schema check failed', { message: (err as Error).message });
	process.exit(1);
}

const deps: AppDeps = {
	db,
	config,
	logger,
	email: resolveEmailSender(config, logger),
};

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const QUEUE = 'coolbeans';

// Repeatable ticks drive the outbox drain and the periodic sweeps.
const queue = new Queue(QUEUE, { connection });
await queue.add('drain-outbox', {}, { repeat: { every: 30_000 }, jobId: 'drain-outbox' });
await queue.add('run-sweeps', {}, { repeat: { every: 300_000 }, jobId: 'run-sweeps' });

const worker = new Worker(
	QUEUE,
	async (job) => {
		if (job.name === 'drain-outbox') {
			const n = await drainOutbox(deps);
			if (n > 0) logger.info('Drained outbox jobs', { count: n });
		} else if (job.name === 'run-sweeps') {
			const result = await runSweeps(deps);
			logger.info('Ran sweeps', result);
		}
	},
	{ connection },
);

worker.on('failed', (job, err) => {
	logger.error('Worker job failed', { job: job?.name, message: err.message });
});

logger.info('Cool Beans worker started', { queue: QUEUE });
