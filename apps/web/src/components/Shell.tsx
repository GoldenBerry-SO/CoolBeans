// ABOUTME: Console chrome — 248px sidebar, 61px header, scrolling main column per docs/DESIGN.md.
// ABOUTME: Pages render into the Outlet; titles come from each route's static data.

import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth.js';
import { AccentButton, BeanMark, SectionLabel } from './ui.js';

const NAV = [
	{ to: '/', label: 'Overview' },
	{ to: '/licenses', label: 'Licenses' },
	{ to: '/products', label: 'Products' },
	{ to: '/customers', label: 'Customers' },
	{ to: '/usage', label: 'Usage' },
	{ to: '/webhooks', label: 'Webhooks' },
	{ to: '/audit', label: 'Audit log' },
] as const;

const TITLES: Record<string, { title: string; sub: string }> = {
	'/': { title: 'Overview', sub: 'All products · last 30 days' },
	'/licenses': { title: 'Licenses', sub: 'Every key, every product' },
	'/products': { title: 'Products', sub: 'Prefixes, seats, and price wiring' },
	'/customers': { title: 'Customers', sub: 'Buyers across all products' },
	'/usage': { title: 'Usage', sub: 'Metered quotas, enforced atomically' },
	'/webhooks': { title: 'Webhooks', sub: 'Stripe and PayPal event stream' },
	'/audit': { title: 'Audit log', sub: 'Every state change, with its actor' },
};

function NavItem({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link
			to={to}
			className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] font-medium text-[13.5px] text-ink-muted hover:bg-ink/5 hover:text-ink [&.active]:bg-ink/6 [&.active]:font-semibold [&.active]:text-ink"
			activeOptions={{ exact: to === '/' }}
			activeProps={{ className: 'active' }}
		>
			{children}
		</Link>
	);
}

export function Shell() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const page = TITLES[pathname] ?? TITLES['/'];
	const { signOut } = useAuth();
	const navigate = useNavigate();

	return (
		<div className="grid h-screen grid-cols-[248px_1fr]">
			<aside className="flex flex-col overflow-y-auto border-ink/9 border-r bg-surface">
				<div className="flex h-[61px] flex-none items-center gap-2.5 border-ink/8 border-b px-4">
					<BeanMark />
					<div className="leading-[1.1]">
						<div className="font-semibold text-[14.5px] tracking-[-0.01em]">Cool Beans</div>
						<div className="font-mono text-[10px] text-ink-faint">coolbeans.tools</div>
					</div>
				</div>
				<div className="px-4 pt-3.5 pb-1.5">
					<SectionLabel>Manage</SectionLabel>
				</div>
				<nav className="flex flex-col gap-px px-3">
					{NAV.map((item) => (
						<NavItem key={item.to} to={item.to}>
							{item.label}
						</NavItem>
					))}
				</nav>
				<div className="mt-auto px-3 pt-3.5 pb-4">
					<a
						href="/portal"
						className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] font-medium text-[13.5px] text-ink-muted no-underline hover:bg-ink/5 hover:text-ink"
					>
						Customer portal →
					</a>
					<div className="mx-2 mt-2.5 flex items-center gap-2.5 border-ink/8 border-t pt-3">
						<span className="inline-flex h-[29px] w-[29px] flex-none items-center justify-center rounded-full bg-positive-tint font-semibold text-[12px] text-positive">
							G
						</span>
						<div className="min-w-0 flex-1 leading-[1.2]">
							<div className="font-medium text-[12.5px]">Goldenberry</div>
							<div className="truncate text-[10.5px] text-ink-faint">admin · global token</div>
						</div>
						<button
							type="button"
							onClick={signOut}
							className="cursor-pointer border-none bg-transparent text-[11px] text-ink-faint hover:text-ink"
						>
							Sign out
						</button>
					</div>
				</div>
			</aside>

			<div className="flex h-screen flex-col overflow-hidden">
				<header className="flex h-[61px] flex-none items-center gap-4 border-ink/8 border-b bg-surface px-7">
					<div className="min-w-0 flex-1">
						<h1 className="m-0 font-semibold text-[16px] tracking-[-0.01em]">{page?.title}</h1>
						<div className="text-[12px] text-ink-faint">{page?.sub}</div>
					</div>
					<div className="flex w-[280px] items-center gap-[9px] rounded-[9px] border border-ink/11 bg-card px-3 py-2 text-ink-faint focus-within:border-positive/50">
						<input
							placeholder="Search keys, emails…"
							className="flex-1 border-none bg-transparent text-[13px] text-ink outline-none"
						/>
						<kbd className="rounded border border-ink/14 px-[5px] py-px font-mono text-[10px]">
							⌘K
						</kbd>
					</div>
					<AccentButton onClick={() => navigate({ to: '/licenses' })}>Issue key</AccentButton>
				</header>
				<main className="flex-1 overflow-y-auto p-7">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
