// ABOUTME: Vite config for the Cool Beans admin dashboard SPA.
// ABOUTME: Proxies the admin API and the public /v1 (portal) calls to the API server in dev.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			'/admin': { target, changeOrigin: true },
			'/auth': { target, changeOrigin: true },
			'/v1': { target, changeOrigin: true },
		},
	},
});
