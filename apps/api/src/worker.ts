// ABOUTME: Cloudflare Workers entrypoint — exports a fetch handler over the shared app.
// ABOUTME: Bindings (D1, secrets) arrive per-request via env and are threaded into createApp.

import { createApp } from './app.js';

export interface Env {
	// D1 and secret bindings land here as features are built (see wrangler.jsonc).
	ENVIRONMENT?: string;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
		const app = createApp();
		return app.fetch(request, env, ctx);
	},
};
