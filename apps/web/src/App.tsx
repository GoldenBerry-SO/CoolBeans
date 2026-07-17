// ABOUTME: Root component of the console — mounts the router over the design-system shell.
// ABOUTME: Look and feel per docs/DESIGN.md; dashboard spec per docs/PRD.md §16.

import { RouterProvider } from '@tanstack/react-router';
import { createConsoleRouter } from './router.js';

const router = createConsoleRouter();

export function App() {
	return <RouterProvider router={router} />;
}
