// ABOUTME: TanStack Router setup (code-based) — the Shell wraps all console pages.
// ABOUTME: createConsoleRouter takes a history so tests can drive it with memory history.

import {
	createRootRoute,
	createRoute,
	createRouter,
	type RouterHistory,
} from '@tanstack/react-router';
import { Shell } from './components/Shell.js';
import { AuditPage } from './pages/Audit.js';
import { CustomersPage } from './pages/Customers.js';
import { LicensesPage } from './pages/Licenses.js';
import { OverviewPage } from './pages/Overview.js';
import { ProductsPage } from './pages/Products.js';
import { UsagePage } from './pages/Usage.js';
import { WebhooksPage } from './pages/Webhooks.js';

const rootRoute = createRootRoute({ component: Shell });

const routeTree = rootRoute.addChildren([
	createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/licenses', component: LicensesPage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/products', component: ProductsPage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/customers', component: CustomersPage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/usage', component: UsagePage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/webhooks', component: WebhooksPage }),
	createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: AuditPage }),
]);

export function createConsoleRouter(history?: RouterHistory) {
	return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createConsoleRouter>;
	}
}
