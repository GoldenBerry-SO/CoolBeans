// ABOUTME: Node (self-host) entrypoint — serves the app with @hono/node-server.
// ABOUTME: Reads configuration from process.env; see .env.example at the repo root.

import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`Cool Beans listening on http://localhost:${info.port}`);
});
