// ABOUTME: How much finished-job history the worker leaves in Redis, applied on the Worker itself.
// ABOUTME: Worker-level options cover jobs whose own opts set nothing, including repeat jobs already scheduled.

// drain-outbox ticks every 30s, so 1,000 completed jobs is about eight hours of history.
// Failed jobs are the ones worth reading later, so they keep a week, capped by count.
export const JOB_RETENTION = {
	removeOnComplete: { count: 1_000 },
	removeOnFail: { count: 5_000, age: 7 * 24 * 60 * 60 },
};
