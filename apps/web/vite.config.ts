// ABOUTME: Vite config for the Cool Beans admin dashboard SPA.
// ABOUTME: Proxies /admin API calls to the local API server during development.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			'/admin': {
				target: process.env.API_URL ?? 'http://localhost:3000',
				changeOrigin: true,
			},
		},
	},
});
