// ABOUTME: Background job processor (PRD §14, §30) — BullMQ over Redis, mirroring pleasehold's worker.
// ABOUTME: Drains the durable outbox and runs periodic sweeps; the outbox is the source of truth.

import {
	type AppDeps,
	drainOutbox,
	loadConfig,
	resolveEmailSender,
	runSweeps,
} from '@coolbeans/api/runtime';
import { createDb, migrate, openSqlite } from '@coolbeans/db';
import { createLogger } from '@coolbeans/logger';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const logger = createLogger();
const config = loadConfig();

if (!config.redisUrl) {
	logger.error('Worker requires REDIS_URL');
	process.exit(1);
}

const db = createDb(openSqlite(config.databaseUrl));
migrate(db);

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
			const result = runSweeps(deps);
			logger.info('Ran sweeps', result);
		}
	},
	{ connection },
);

worker.on('failed', (job, err) => {
	logger.error('Worker job failed', { job: job?.name, message: err.message });
});

logger.info('Cool Beans worker started', { queue: QUEUE });
