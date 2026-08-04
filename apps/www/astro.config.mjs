// ABOUTME: Astro config for the Cool Beans marketing site — static output, Tailwind 4 via Vite.
// ABOUTME: Deploys as plain static files; no server runtime, no islands until something needs one.

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://coolbeans.tools',
	vite: {
		plugins: [tailwindcss()],
	},
});
