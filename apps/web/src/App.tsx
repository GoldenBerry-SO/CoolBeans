// ABOUTME: Root of the console app — providers (Query, Auth) over the router.
// ABOUTME: Look and feel per docs/DESIGN.md; dashboard spec per docs/PRD.md §16.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from '#components/shadcn/sonner';
import { AuthProvider } from './lib/auth.js';
import { createConsoleRouter } from './router.js';

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const router = createConsoleRouter();

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<RouterProvider router={router} />
				<Toaster />
			</AuthProvider>
		</QueryClientProvider>
	);
}
