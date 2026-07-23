// ABOUTME: TanStack Router setup (code-based) — gated console pages plus the public portal route.
// ABOUTME: createConsoleRouter takes a history so tests can drive it with memory history.

import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type RouterHistory,
} from '@tanstack/react-router';
import { ConsoleLayout } from './components/ConsoleLayout.js';
import { AuditPage } from './pages/Audit.js';
import { BillingPage } from './pages/Billing.js';
import { CustomersPage } from './pages/Customers.js';
import { IntegrationPage } from './pages/Integration.js';
import { LicenseDetailPage } from './pages/LicenseDetail.js';
import { LicensesPage } from './pages/Licenses.js';
import { OverviewPage } from './pages/Overview.js';
import { PortalPage } from './pages/Portal.js';
import { ProductsPage } from './pages/Products.js';
import { TeamPage } from './pages/Team.js';
import { UsagePage } from './pages/Usage.js';
import { WebhooksPage } from './pages/Webhooks.js';

const rootRoute = createRootRoute({ component: Outlet });

// The customer portal is public (key is the credential) and lives outside the admin gate.
const portalRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/portal',
	component: PortalPage,
});

// The console pages sit behind the admin-token gate.
const consoleLayout = createRoute({
	getParentRoute: () => rootRoute,
	id: 'console',
	component: ConsoleLayout,
});
const consoleRoutes = consoleLayout.addChildren([
	createRoute({ getParentRoute: () => consoleLayout, path: '/', component: OverviewPage }),
	createRoute({ getParentRoute: () => consoleLayout, path: '/licenses', component: LicensesPage }),
	createRoute({
		getParentRoute: () => consoleLayout,
		path: '/licenses/$key',
		component: LicenseDetailPage,
	}),
	createRoute({ getParentRoute: () => consoleLayout, path: '/products', component: ProductsPage }),
	createRoute({
		getParentRoute: () => consoleLayout,
		path: '/products/$slug/integration',
		component: IntegrationPage,
	}),
	createRoute({
		getParentRoute: () => consoleLayout,
		path: '/customers',
		component: CustomersPage,
	}),
	createRoute({ getParentRoute: () => consoleLayout, path: '/usage', component: UsagePage }),
	createRoute({ getParentRoute: () => consoleLayout, path: '/webhooks', component: WebhooksPage }),
	createRoute({ getParentRoute: () => consoleLayout, path: '/audit', component: AuditPage }),
	createRoute({ getParentRoute: () => consoleLayout, path: '/team', component: TeamPage }),
	// The page itself states the self-host case rather than 404ing, so a bookmarked link
	// from a hosted instance does not look broken after someone moves to self-hosting.
	createRoute({ getParentRoute: () => consoleLayout, path: '/billing', component: BillingPage }),
]);

const routeTree = rootRoute.addChildren([portalRoute, consoleRoutes]);

export function createConsoleRouter(history?: RouterHistory) {
	return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createConsoleRouter>;
	}
}
