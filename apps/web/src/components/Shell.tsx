// ABOUTME: Console chrome — 248px icon sidebar, 64px header with pill search, per docs/DESIGN.md.
// ABOUTME: Pages render into the Outlet under a 28px page heading; product scope lives here too.

import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '#components/shadcn/dropdown-menu';
import {
	Sidebar as ShadcnSidebar,
	SidebarContent as ShadcnSidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from '#components/shadcn/sidebar';
import { getAdminEmail } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useProducts } from '../lib/queries.js';
import { productColor, ScopeProvider, useScope } from '../lib/scope.js';
import { IssueKeyDialog } from './IssueKeyDialog.js';
import { AccentButton, BeanMark, PlusIcon } from './ui.js';

const ICONS: Record<string, ReactNode> = {
	overview: (
		<>
			<rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
			<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
			<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
			<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
		</>
	),
	licenses: (
		<>
			<circle cx="7.5" cy="8" r="4" />
			<path d="M10.5 11 L20 20.5 M17 17.5 L19.5 15" />
		</>
	),
	products: (
		<>
			<path d="M12 3 L20 7 V17 L12 21 L4 17 V7 Z" />
			<path d="M4 7 L12 11 L20 7 M12 11 V21" />
		</>
	),
	customers: (
		<>
			<circle cx="9" cy="8" r="3.4" />
			<circle cx="16.5" cy="9.5" r="2.6" />
			<path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15 18.5c0-2 1.2-3.4 3-3.4s2.5 1 2.5 2.4" />
		</>
	),
	usage: <path d="M5 19V11 M12 19V5 M19 19V14" strokeLinecap="round" />,
	webhooks: (
		<>
			<circle cx="6" cy="6" r="2.6" />
			<circle cx="18" cy="18" r="2.6" />
			<path d="M8 7.5C13 9 15.5 12 16.5 16" />
		</>
	),
	audit: <path d="M6 5h12 M6 10h12 M6 15h8" strokeLinecap="round" />,
};

const NAV = [
	{ to: '/', icon: 'overview', label: 'Overview' },
	{ to: '/licenses', icon: 'licenses', label: 'Licenses' },
	{ to: '/products', icon: 'products', label: 'Products' },
	{ to: '/customers', icon: 'customers', label: 'Customers' },
	{ to: '/usage', icon: 'usage', label: 'Usage' },
	{ to: '/webhooks', icon: 'webhooks', label: 'Webhooks' },
	{ to: '/audit', icon: 'audit', label: 'Audit log' },
	{ to: '/team', icon: 'customers', label: 'Team' },
] as const;

const TITLES: Record<string, { title: string; sub: string }> = {
	'/': { title: 'Overview', sub: 'Everything Cool Beans issued and validated, at a glance' },
	'/licenses': { title: 'Licenses', sub: 'Every key across your products' },
	'/products': { title: 'Products', sub: 'Prefixes, seat models and payment wiring' },
	'/customers': { title: 'Customers', sub: 'People holding a Cool Beans key' },
	'/usage': { title: 'Usage', sub: 'Metered counters, enforced at the edge' },
	'/webhooks': { title: 'Webhooks', sub: 'Stripe & PayPal events feeding issuance' },
	'/audit': { title: 'Audit log', sub: 'Every state change, with actor and detail' },
	'/team': { title: 'Team', sub: 'Who can sign in to this console' },
};

function NavIcon({ name }: { name: string }) {
	return (
		<svg
			width="17"
			height="17"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			className="flex-none"
			aria-hidden="true"
		>
			{ICONS[name]}
		</svg>
	);
}

function NavItem({
	to,
	icon,
	children,
	onNavigate,
}: {
	to: string;
	icon: string;
	children: ReactNode;
	onNavigate?: () => void;
}) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const isActive = to === '/' ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				asChild
				isActive={isActive}
				className="h-auto gap-3 rounded-[8px] px-3 py-2 font-medium text-[14px] text-ink-body hover:bg-ink/5 hover:text-ink data-[active=true]:bg-transparent data-[active=true]:text-positive-nav"
			>
				<Link to={to} onClick={onNavigate}>
					<NavIcon name={icon} />
					<span>{children}</span>
				</Link>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function ScopeSwitcher({ onSelect }: { onSelect?: () => void }) {
	const { scope, setScope } = useScope();
	const products = useProducts();
	const items = [
		{ slug: 'all', name: 'All products', color: '#9a9a92' },
		...(products.data ?? []).map((p, i) => ({
			slug: p.slug,
			name: p.name,
			color: productColor(i),
		})),
	];
	const current = items.find((i) => i.slug === scope) ?? items[0];

	return (
		<div className="px-4 pt-3.5 pb-2.5">
			<DropdownMenu>
				<DropdownMenuTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[9px] border border-ink/11 bg-card px-[11px] py-[9px] text-[13px] text-ink outline-none hover:border-ink/24 focus-visible:border-ink/24">
					<span className="flex min-w-0 items-center gap-2">
						<span
							className="h-[7px] w-[7px] flex-none rounded-[2px]"
							style={{ background: current.color }}
						/>
						<span className="truncate">{current.name}</span>
					</span>
					<span className="flex-none text-[11px] text-ink-faint">▾</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="cbin">
					{items.map((i) => (
						<DropdownMenuItem
							key={i.slug}
							onSelect={() => {
								setScope(i.slug);
								onSelect?.();
							}}
							className={scope === i.slug ? 'font-semibold' : 'font-normal'}
						>
							<span
								className="h-[7px] w-[7px] flex-none rounded-[2px]"
								style={{ background: i.color }}
							/>
							<span className="flex-1">{i.name}</span>
							{scope === i.slug ? (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#4d6b16"
									strokeWidth="2.4"
									aria-hidden="true"
								>
									<path d="M5 12.5l4.5 4.5L19 7" />
								</svg>
							) : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function AppSidebar({ onSignOut }: { onSignOut: () => void }) {
	const adminEmail = getAdminEmail();
	const { isMobile, setOpenMobile } = useSidebar();
	const closeMobile = () => {
		if (isMobile) setOpenMobile(false);
	};

	return (
		<ShadcnSidebar
			collapsible="offcanvas"
			className="border-ink/9 bg-card [&_[data-sidebar=sidebar]]:bg-card"
		>
			<SidebarHeader className="gap-0 p-0">
				<div className="flex h-16 flex-none items-center gap-2.5 px-[18px]">
					<BeanMark />
					<div className="font-semibold text-[15px] tracking-[-0.01em]">Cool Beans</div>
				</div>
				<ScopeSwitcher onSelect={closeMobile} />
			</SidebarHeader>
			<ShadcnSidebarContent className="gap-0">
				<SidebarGroup className="p-0">
					<SidebarGroupLabel className="h-auto px-4 pt-2.5 pb-1 font-semibold text-[10px] text-ink-faint uppercase tracking-[0.13em]">
						Manage
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<nav aria-label="Console pages">
							<SidebarMenu className="gap-px px-3 pt-0.5">
								{NAV.map((item) => (
									<NavItem key={item.to} to={item.to} icon={item.icon} onNavigate={closeMobile}>
										{item.label}
									</NavItem>
								))}
							</SidebarMenu>
						</nav>
					</SidebarGroupContent>
				</SidebarGroup>
			</ShadcnSidebarContent>
			<SidebarFooter className="gap-0 px-3 pt-3.5 pb-4">
				<a
					href="/portal"
					onClick={closeMobile}
					className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] font-medium text-[13.5px] text-ink-muted no-underline hover:bg-ink/5 hover:text-ink"
				>
					<svg
						width="17"
						height="17"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.7"
						strokeLinecap="round"
						className="flex-none"
						aria-hidden="true"
					>
						<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
					</svg>
					<span>Customer portal</span>
				</a>
				<div className="mx-2 mt-2.5 flex items-center gap-2.5 border-ink/8 border-t pt-3">
					<span className="inline-flex h-[29px] w-[29px] flex-none items-center justify-center rounded-full bg-positive-tint font-semibold text-[12px] text-positive">
						{(adminEmail ?? 'G').charAt(0).toUpperCase()}
					</span>
					<div className="min-w-0 flex-1 leading-[1.2]">
						<div className="truncate font-medium text-[12.5px]">{adminEmail ?? 'Goldenberry'}</div>
						<div className="truncate text-[10.5px] text-ink-faint">
							{adminEmail ? 'admin · magic code' : 'admin · global token'}
						</div>
					</div>
					<button
						type="button"
						onClick={() => {
							onSignOut();
							closeMobile();
						}}
						title="Sign out"
						className="inline-flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[7px] border-none bg-transparent text-ink-faint hover:bg-ink/6 hover:text-ink"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
						</svg>
					</button>
				</div>
			</SidebarFooter>
		</ShadcnSidebar>
	);
}

function RoundButton({ title, children }: { title: string; children: ReactNode }) {
	return (
		<button
			type="button"
			title={title}
			className="inline-flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink-muted hover:bg-ink/5"
		>
			{children}
		</button>
	);
}

/**
 * Header search. Typing filters the license table, so it navigates there —
 * searching from Webhooks and watching nothing happen would be worse than no box.
 */
function HeaderSearch() {
	const { query, setQuery } = useScope();
	const navigate = useNavigate();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	return (
		<div className="flex min-w-0 max-w-[560px] flex-1 items-center gap-2 rounded-full border border-transparent bg-canvas px-3 py-[9px] text-ink-label focus-within:border-positive/45 focus-within:bg-card sm:gap-2.5 sm:px-[15px]">
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.9"
				aria-hidden="true"
			>
				<circle cx="10.5" cy="10.5" r="6.5" />
				<path d="M20 20l-4.5-4.5" />
			</svg>
			<input
				ref={inputRef}
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					if (e.target.value) navigate({ to: '/licenses' });
				}}
				placeholder="Search keys, emails…"
				aria-label="Search keys and emails"
				className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none"
			/>
			{query ? (
				<button
					type="button"
					onClick={() => setQuery('')}
					aria-label="Clear search"
					className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-ink-faint hover:text-ink"
				>
					✕
				</button>
			) : (
				<kbd className="hidden rounded border border-ink/14 px-[5px] py-px font-mono text-[10px] sm:inline">
					⌘K
				</kbd>
			)}
		</div>
	);
}

export function Shell() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const page = TITLES[pathname];
	// Detail views carry their own header (the key itself), so the generic page
	// heading is suppressed there rather than mislabelling the screen.
	const showHeading = Boolean(page);
	const { signOut } = useAuth();
	const [showIssue, setShowIssue] = useState(false);

	return (
		<ScopeProvider>
			<SidebarProvider
				className="h-dvh min-h-0 overflow-hidden"
				style={{ '--sidebar-width': '248px' } as CSSProperties}
			>
				<AppSidebar onSignOut={signOut} />
				<SidebarInset className="h-dvh min-w-0 overflow-hidden bg-card">
					<header className="flex h-16 flex-none items-center gap-2.5 border-ink/8 border-b bg-card px-3.5 sm:gap-3.5 sm:px-6 lg:border-b-0 lg:px-10">
						<SidebarTrigger className="h-9 w-9 flex-none rounded-[9px] border border-ink/10 bg-card text-ink-muted hover:bg-ink/4 hover:text-ink" />
						<HeaderSearch />
						<div className="hidden flex-1 lg:block" />
						<div className="hidden items-center sm:flex">
							<RoundButton title="Help">
								<span className="font-semibold text-[14px]">?</span>
							</RoundButton>
							<RoundButton title="Notifications">
								<svg
									width="17"
									height="17"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.7"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6" />
									<path d="M10.3 20a2 2 0 003.4 0" />
								</svg>
							</RoundButton>
						</div>
						<AccentButton onClick={() => setShowIssue(true)} className="flex-none px-2.5 sm:px-3.5">
							<PlusIcon />
							<span className="hidden sm:inline">Issue key</span>
							<span className="sm:hidden">Issue</span>
						</AccentButton>
					</header>
					<div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-5 pb-8 sm:px-6 sm:pt-7 lg:px-10 lg:pt-[30px] lg:pb-12">
						{showHeading ? (
							<div className="mt-0.5 mb-5 sm:mb-[26px]">
								<h1 className="m-0 font-bold text-[24px] text-ink tracking-[-0.02em] sm:text-[28px]">
									{page?.title}
								</h1>
								<p className="m-0 mt-[5px] text-[13px] text-ink-soft sm:text-[14px]">{page?.sub}</p>
							</div>
						) : null}
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
			{showIssue ? <IssueKeyDialog onClose={() => setShowIssue(false)} /> : null}
		</ScopeProvider>
	);
}
