// ABOUTME: Barrel for the Drizzle schema — the PRD §17 data model, one table group per file.
// ABOUTME: Portable SQL — SQLite for dev/self-host, Postgres for the k8s production instance.

export * from './activations.js';
export * from './admins.js';
export * from './events.js';
export * from './license-revocations.js';
export * from './licenses.js';
export * from './metrics.js';
export * from './outbox.js';
export * from './pending-revocations.js';
export * from './products.js';
export * from './purchases.js';
export * from './signing-keys.js';
export * from './validation-counters.js';
