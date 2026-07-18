// ABOUTME: Programmatic runtime surface (PRD §30) — the bits the worker and embedders need.
// ABOUTME: Re-exports config, deps, and the background-job entrypoints so the worker stays thin.

export { createApp } from './app.js';
export { type Config, loadConfig } from './config.js';
export type { AppDeps } from './deps.js';
export { resolveEmailSender } from './services/email.js';
export { drainOutbox } from './services/outbox.js';
export { createPayPalGateway } from './services/paypal-gateway.js';
export { createStripeGateway } from './services/stripe-gateway.js';
export { runSweeps } from './services/sweep.js';
