// ABOUTME: Background job processor — BullMQ over Redis, mirroring pleasehold's worker app.
// ABOUTME: Queues, the outbox sweep, and schedules land with the background-jobs issue.

import { createLogger } from '@coolbeans/logger';

const logger = createLogger();
logger.info('Cool Beans worker starting', {
	note: 'queues land with the background-jobs issue',
});
