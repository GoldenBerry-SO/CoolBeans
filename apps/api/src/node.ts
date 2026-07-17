// ABOUTME: Node (self-host) entrypoint — serves the app with @hono/node-server.
// ABOUTME: Reads configuration from process.env; see .env.example at the repo root.

import { createLogger } from '@coolbeans/logger';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const logger = createLogger();
const app = createApp({ logger });
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
	logger.info('Cool Beans listening', { port: info.port });
});
