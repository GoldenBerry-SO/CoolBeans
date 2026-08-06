# Graph Report - .  (2026-08-06)

## Corpus Check
- 389 files · ~273,840 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2427 nodes · 5119 edges · 168 communities (145 shown, 23 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 122 edges (avg confidence: 0.87)
- Token cost: 339,608 input · 0 output

## Community Hubs (Navigation)
- Admin Route Registration
- Email Package Dependencies
- Admin Route Tests
- HTTP Errors & LemonSqueezy Shapes
- Console Data Queries
- Console Query Hooks & Price Labels
- Database Package Dependencies
- Key Generation & Normalization
- Key Issuance Admin API
- Worker Package Dependencies
- Stripe & Grants Route Tests
- Console UI Primitives
- Console Shell & Navigation
- Auth Package Dependencies
- CLI Package Dependencies
- SDK Client Core
- Config & Rate Limiting
- Console Magic-Code Auth
- Token Signing & Crypto
- Public v1 Endpoints & Serializers
- Console Integration Brief
- Marketing Site Dependencies
- Docs Site Concepts
- Console Dialogs
- Sidebar Component
- Root Workspace Tooling
- SDK Package Manifest
- Connect Webhook & Event Pruning
- Biome Lint Config
- Logger Package Manifest
- Issuance & Payments Services
- SDK Contract Fixture Tests
- Product Admin Routes
- Event Ordering & Reconciliation
- Console Webhook Queries
- Email Sender Seam
- Licence Grants Service
- Admin Auth Middleware
- Team & Keyset Tests
- Webhook Route Registration
- Billing Isolation Tests
- SDK Access State Types
- API Package Dependencies
- Console UI Dependencies
- Payments & Stripe Namespace Docs
- Rate Limit & Offline Activation Tests
- Billing Subscription Service
- Console Admin Queries
- Landing Page Components
- CLI HTTP Client
- Accounts & Subscriptions Schema
- Activations & Revocations Schema
- Turborepo Pipeline
- Billing Gateway
- Shadcn Component Aliases
- Console TypeScript Config
- Concurrency Rationale & Rescue Docs
- Database Client & Migrations
- Products & Icons Schema
- Console App Bootstrap
- HTTP API & PRD Endpoint Docs
- Structured Logger
- Journey Test Runner
- API Dev Dependencies
- Usage Metering
- Billing & Tenancy Tests
- Examples Package Manifest
- Outbox & Column Helpers Schema
- Stripe Gateway Interface
- Auth & Design Token Docs
- App Factory & OpenAPI
- Node Entry & Redis Store
- Console Dev Dependencies
- SDK Unit Tests
- SDK TypeScript Config
- Postgres Atomicity Script
- Root TypeScript Config
- Self-Host Limits & Compose
- Marketing Deploy & PWA Shell
- PayPal Gateway & Runtime
- API TypeScript Config
- Worker TypeScript Config
- Examples TypeScript Config
- CLI TypeScript Config
- Grants & Purchases Schema
- CI & Deploy Jobs
- Stripe Gateway Factory
- API Build Config
- Offline Token Docs
- Email TypeScript Config
- Journey Package Manifest
- Worker Entry Point
- Auth Build Config
- Database TypeScript Config
- Database Build Config
- Email Build Config
- Logger Build Config
- SDK Build Config
- API Package Manifest
- API Package Scripts
- Outbox Job Claiming
- Console Package Manifest
- Console Package Scripts
- Offline & Tenancy Ground Rules
- Architecture References
- Smoke Test Script
- Community Files
- Integration Brief Service
- Dialog Primitives
- Outbound Webhook Docs
- Tenancy Rules Docs
- Marketing TypeScript Config
- Auth TypeScript Config
- Logger TypeScript Config
- Journey Data Validation
- Credential & SQL Ground Rules
- Plan Limit Tests
- Brand Icon Set
- Project Personas & Docs
- Admin Users Schema
- Missed-Sale Rescue Tests
- End-to-End Test
- Key Generation Spec Docs
- Concurrency Review Rules
- Cloud & Connect Overview
- Electron Example
- Tauri Example
- Journey Shell Harness
- Race Test Setup
- Frozen Contract Rules
- Node CLI Example
- Better Auth Factory
- Database Client Tests
- Stripe Mock Server
- Console Static Mount
- Browser Example
- Example Env Types
- Atomicity Script Entry
- Provider Webhook Check
- No Driver Rowcounts Test
- Button Component
- Logger Dependency Link
- Hono Dependency
- Scalar API Reference
- Stripe Dependency
- Hook Form Resolvers
- Lucide Icons
- React DOM
- Sonner Dependency
- Tailwind Dependency
- Tailwind Vite Plugin
- TanStack Query

## God Nodes (most connected - your core abstractions)
1. `makeHarness()` - 74 edges
2. `nowDate()` - 71 edges
3. `AppDeps` - 65 edges
4. `createProduct()` - 49 edges
5. `writeAudit()` - 48 edges
6. `TestHarness` - 46 edges
7. `api()` - 46 edges
8. `CoolBeans` - 39 edges
9. `badRequest()` - 32 edges
10. `issueKey()` - 32 edges

## Surprising Connections (you probably didn't know these)
- `Customer portal endpoints (lookup, recover, billing-session)` --semantically_similar_to--> `Key generation and normalization`  [INFERRED] [semantically similar]
  apps/www/src/pages/docs/http-api.md → docs/PRD.md
- `api service (apps/api/dist/node.js)` --shares_data_with--> `BILLING_* vs STRIPE_* separate namespaces`  [INFERRED]
  docker-compose.yml → CLAUDE.md
- `Extra concurrency review before merge` --semantically_similar_to--> `Codex review for concurrency changes`  [INFERRED] [semantically similar]
  CONTRIBUTING.md → CLAUDE.md
- `migrate service (one-shot migration runner)` --references--> `packages/db storage adapter`  [INFERRED]
  docker-compose.yml → CONTRIBUTING.md
- `Code of Conduct enforcement (hello@coolbeans.tools)` --semantically_similar_to--> `Private vulnerability reporting`  [INFERRED] [semantically similar]
  CODE_OF_CONDUCT.md → SECURITY.md

## Import Cycles
- 2-file cycle: `packages/email/src/index.ts -> packages/email/src/senders.ts -> packages/email/src/index.ts`

## Hyperedges (group relationships)
- **Self-host startup order: postgres and redis healthy, migrate completes, then api and worker** — docker_compose_postgres_service, docker_compose_redis_service, docker_compose_migrate_service, docker_compose_api_service, docker_compose_worker_service [EXTRACTED 1.00]
- **Cloud deploy pipeline: verify, build one GHCR image, GitOps rollout** — _github_workflows_deploy_verify_job, _github_workflows_deploy_build_and_push_job, _github_workflows_deploy_rollout_job, _github_workflows_deploy_bare_sha_tag, _github_workflows_deploy_oci_source_labels [EXTRACTED 1.00]
- **The five non-negotiable licensing rules** — claude_frozen_section_9_contract, claude_offline_tolerant_by_contract, claude_key_is_the_credential, claude_atomic_limit_enforcement, claude_portable_sql_adapter, contributing_non_negotiable_rules [EXTRACTED 1.00]
- **Payment to key issuance flow** — docs_prd_stripe_connection, docs_prd_license_grant, docs_prd_stripe_webhook, docs_prd_idempotency_two_layers, docs_prd_key_delivery, docs_prd_purchase_lookup, docs_prd_license_object [EXTRACTED 1.00]
- **Offline access decision model** — docs_prd_offline_token, docs_prd_renewal_buffer, docs_prd_access_decision_union, apps_www_src_pages_docs_offline_three_states, apps_www_src_pages_docs_offline_clock_rollback, docs_architecture_access_states_contract, docs_prd_offline_tolerant_by_contract [EXTRACTED 1.00]
- **Three Stripe namespace isolation** — apps_www_src_pages_docs_self_hosting_stripe_namespace, apps_www_src_pages_docs_self_hosting_billing_stripe_namespace, apps_www_src_pages_docs_self_hosting_connect_stripe_namespace, docs_architecture_billing_namespace_separation, docs_architecture_app_metadata_stamp, docs_architecture_platform_billing [EXTRACTED 1.00]
- **One Cool Beans brand mark (black coffee bean in sunglasses, lime rounded square, sparkles) rendered at every size across console and marketing site** — apps_web_public_apple_touch_icon_apple_touch_icon, apps_web_public_favicon_16_favicon_16, apps_web_public_favicon_32_favicon_32, apps_web_public_icon_192_pwa_icon_192, apps_web_public_icon_512_pwa_icon_512, apps_web_public_logo_cool_beans_logo, apps_www_public_cool_beans_icon_site_icon [INFERRED 0.95]
- **apps/web icon size ladder: 16, 32, apple-touch, 192, 512 exports of the same mark for tab, iOS and PWA install surfaces** — apps_web_public_favicon_16_favicon_16, apps_web_public_favicon_32_favicon_32, apps_web_public_apple_touch_icon_apple_touch_icon, apps_web_public_icon_192_pwa_icon_192, apps_web_public_icon_512_pwa_icon_512 [INFERRED 0.95]
- **Console logo, console 512 icon and marketing site icon are the same artwork, so the two apps share one visual identity** — apps_web_public_logo_cool_beans_logo, apps_web_public_icon_512_pwa_icon_512, apps_www_public_cool_beans_icon_site_icon [INFERRED 0.85]

## Communities (168 total, 23 thin omitted)

### Community 0 - "Admin Route Registration"
Cohesion: 0.11
Nodes (42): forbidden(), notFound(), validationError(), registerAdminBillingRoutes(), registerAdminRoutes(), registerAdminProductRoutes(), registerAdminRescueRoutes(), rescueBody (+34 more)

### Community 1 - "Email Package Dependencies"
Cohesion: 0.04
Nodes (44): nodemailer, dependencies, nodemailer, react, @react-email/components, @react-email/render, resend, description (+36 more)

### Community 2 - "Admin Route Tests"
Cohesion: 0.13
Nodes (13): drainOutbox(), record(), seedLicense(), TestHarness, cloud, overEveryLimit(), rawExec(), ADMIN (+5 more)

### Community 3 - "HTTP Errors & LemonSqueezy Shapes"
Cohesion: 0.12
Nodes (36): activationLimitReached(), ApiError, conflict(), ErrorBody, invalidKey(), licenseDisabled(), unknownKey(), errorShape() (+28 more)

### Community 4 - "Console Data Queries"
Cohesion: 0.08
Nodes (34): actionVerb(), detailHighlight(), formatDetail(), NAMED_VERBS, EntitlementMap, ConnectStripeInput, ConnectStripeResult, CreateGrantInput (+26 more)

### Community 5 - "Console Query Hooks & Price Labels"
Cohesion: 0.11
Nodes (29): api(), priceAmount(), priceName(), bumpIconVersion(), StripePriceRow, useArchiveProduct(), useConnectStripe(), useCreateGrant() (+21 more)

### Community 6 - "Database Package Dependencies"
Cohesion: 0.05
Nodes (38): drizzle-kit, dependencies, drizzle-orm, postgres, devDependencies, drizzle-kit, @electric-sql/pglite, tsup (+30 more)

### Community 7 - "Key Generation & Normalization"
Cohesion: 0.13
Nodes (23): ALPHABET, ALPHABET_SET, drawSymbols(), generateKey(), generateKeyBody(), isValidKey(), looksLikeKey(), normalizeAgainst() (+15 more)

### Community 8 - "Key Issuance Admin API"
Cohesion: 0.11
Nodes (29): planLimitReached(), COLUMNS, csvRow(), registerAdminExportRoutes(), adminLicenseView(), extendBody, issueBody, offlineActivationBody (+21 more)

### Community 9 - "Worker Package Dependencies"
Cohesion: 0.05
Nodes (36): dependencies, bullmq, @coolbeans/api, @coolbeans/db, @coolbeans/email, @coolbeans/logger, ioredis, devDependencies (+28 more)

### Community 10 - "Stripe & Grants Route Tests"
Cohesion: 0.07
Nodes (9): CATALOG, BASIC, PRO, ADMIN, PROVIDER_EVENT_RETENTION_DAYS, rawQuery(), reset(), tablesToTruncate() (+1 more)

### Community 11 - "Console UI Primitives"
Cohesion: 0.10
Nodes (27): ConsoleLayout(), Dialog(), Shell(), BeanMark(), CardHeader(), InkButton(), KindText(), LimitBadge() (+19 more)

### Community 12 - "Console Shell & Navigation"
Cohesion: 0.10
Nodes (27): AppSidebar(), BILLING_NAV, HeaderSearch(), ICONS, NAV, ScopeSwitcher(), TITLES, Card() (+19 more)

### Community 13 - "Auth Package Dependencies"
Cohesion: 0.06
Nodes (33): better-auth, dependencies, better-auth, @coolbeans/db, devDependencies, drizzle-orm, @electric-sql/pglite, tsup (+25 more)

### Community 14 - "CLI Package Dependencies"
Cohesion: 0.06
Nodes (32): commander, bin, beans, dependencies, commander, description, devDependencies, tsup (+24 more)

### Community 16 - "Config & Rate Limiting"
Cohesion: 0.09
Nodes (15): Config, ConfigError, loadConfig(), requireVar(), base, authRateLimiter(), clientKey(), ipRateLimiter() (+7 more)

### Community 17 - "Console Magic-Code Auth"
Cohesion: 0.12
Nodes (28): readBody(), registerAuthRoutes(), requestBody, verifyBody, accountNameFor(), adminForSession(), hashesEqual(), inviteAdmin() (+20 more)

### Community 18 - "Token Signing & Crypto"
Cohesion: 0.16
Nodes (23): decryptSecret(), deriveKey(), encryptSecret(), b64url(), decodeTokenHeader(), generateSigningKeyPair(), privateKeyObject(), publicKeyObject() (+15 more)

### Community 19 - "Public v1 Endpoints & Serializers"
Cohesion: 0.13
Nodes (25): toDisplayKey(), InstanceObject, LicenseObject, serializeInstance(), serializeLicense(), activateBody, keysetBody, readJson() (+17 more)

### Community 20 - "Console Integration Brief"
Cohesion: 0.13
Nodes (24): agentPrompt(), briefUrl(), buildSnippets(), ConfigFact, configFacts(), EndpointFact, FILE_STORAGE(), guideUrl() (+16 more)

### Community 21 - "Marketing Site Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, astro, devDependencies, @astrojs/check, tailwindcss, @tailwindcss/vite, typescript, vitest (+20 more)

### Community 22 - "Docs Site Concepts"
Cohesion: 0.11
Nodes (29): Docs: the beans CLI, beans key issue, Gate features on state.entitlements only, The mental model (key → activate → validate), The one rule: branch on state.decision and nothing else, The verdict and its reason codes, Docs: What Cool Beans is, Clock rollback floor (+21 more)

### Community 23 - "Console Dialogs"
Cohesion: 0.14
Nodes (20): Field(), inputClass, IssueKeyDialog(), KIND_HINTS, OfflineActivationDialog(), AccentButton(), deviceLabel(), entitlementsPayload() (+12 more)

### Community 24 - "Sidebar Component"
Cohesion: 0.08
Nodes (8): Sidebar(), SidebarContext, SidebarContextProps, SidebarMenuButton(), sidebarMenuButtonVariants, SidebarRail(), SidebarTrigger(), useSidebar()

### Community 25 - "Root Workspace Tooling"
Cohesion: 0.07
Nodes (27): @biomejs/biome, husky, description, devDependencies, @biomejs/biome, husky, turbo, typescript (+19 more)

### Community 26 - "SDK Package Manifest"
Cohesion: 0.07
Nodes (27): description, devDependencies, tsup, @types/node, typescript, vitest, exports, files (+19 more)

### Community 27 - "Connect Webhook & Event Pruning"
Cohesion: 0.22
Nodes (21): nowDate(), eventAccount(), registerConnectWebhook(), pruneProviderEvents(), createCloudConnection(), disconnectConnection(), completeConnectAuthorization(), hashState() (+13 more)

### Community 28 - "Biome Lint Config"
Cohesion: 0.08
Nodes (25): source, assist, actions, noUnusedImports, files, includes, formatter, enabled (+17 more)

### Community 29 - "Logger Package Manifest"
Cohesion: 0.08
Nodes (25): description, devDependencies, tsup, typescript, vitest, exports, files, dist (+17 more)

### Community 30 - "Issuance & Payments Services"
Cohesion: 0.18
Nodes (21): createPurchase(), Kind, enqueue(), advanceSubscriptionExpiry(), Claim, ClaimableEvent, ClaimResult, EnsureArgs (+13 more)

### Community 31 - "SDK Contract Fixture Tests"
Cohesion: 0.15
Nodes (17): CANONICAL, contract, ContractCase, signed(), SWIFT_COPY, T0, TokenSpec, blob() (+9 more)

### Community 32 - "Product Admin Routes"
Cohesion: 0.15
Nodes (16): AppDeps, createProductBody, iconBody, metricBody, WebhookContext, deleteProductIcon(), ICON_MAX_BYTES, ICON_MIMES (+8 more)

### Community 33 - "Event Ordering & Reconciliation"
Cohesion: 0.19
Nodes (19): lastSubscriptionEventAt(), markSubscriptionEventApplied(), shouldApplySubscriptionEvent(), dropPendingRevocation(), disputeReferences(), ensureLicenseForSession(), findLicenseForCharge(), findLicenseForDispute() (+11 more)

### Community 34 - "Console Webhook Queries"
Cohesion: 0.16
Nodes (18): formatDateTime(), useCreateWebhookEndpoint(), useDisableWebhookEndpoint(), useProviderEvents(), useProviders(), useRescueCheckout(), useRotateWebhookSecret(), useUnfulfilled() (+10 more)

### Community 35 - "Email Sender Seam"
Cohesion: 0.14
Nodes (14): EmailSender, OutgoingEmail, createConsoleSender(), createResendSender(), createSmtpSender(), SmtpOptions, email, BrandHeader() (+6 more)

### Community 36 - "Licence Grants Service"
Cohesion: 0.21
Nodes (18): badRequest(), grantBody, registerAdminGrantRoutes(), assertNotBillingPrice(), createGrant(), CreateGrantArgs, entitlementsToStore(), priceLookupFailureMessage() (+10 more)

### Community 37 - "Admin Auth Middleware"
Cohesion: 0.22
Nodes (17): unauthorized(), adminAuth(), isAdminRequest(), safeEqual(), accountForAdminToken(), consoleAuth(), PRODUCT_SCOPED, scopeAllows() (+9 more)

### Community 38 - "Team & Keyset Tests"
Cohesion: 0.12
Nodes (6): lastCode(), req(), signIn(), CapturedLine, fakeClock, fakePayPalGateway()

### Community 39 - "Webhook Route Registration"
Cohesion: 0.19
Nodes (16): registerBillingWebhook(), registerWebhookRoutes(), registerPayPalWebhook(), process(), registerStripeWebhook(), BILLING_PROVIDER, foreignAppOf(), EVENT (+8 more)

### Community 40 - "Billing Isolation Tests"
Cohesion: 0.15
Nodes (12): cloud, harness(), bothConfigured, harness(), checkoutCompleted(), cloud, harness(), proSubscription() (+4 more)

### Community 41 - "SDK Access State Types"
Cohesion: 0.11
Nodes (15): AccessState, ActivateResult, AllowReason, CoolBeansError, CoolBeansOptions, defaultStorage(), DenyReason, errorMessage() (+7 more)

### Community 42 - "API Package Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @coolbeans/auth, @coolbeans/db, @coolbeans/email, drizzle-orm, @hono/node-server, hono-rate-limiter, @hono/zod-openapi (+11 more)

### Community 43 - "Console UI Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, class-variance-authority, clsx, radix-ui, react, react-hook-form, tailwind-merge, @tanstack/react-router (+11 more)

### Community 44 - "Payments & Stripe Namespace Docs"
Cohesion: 0.13
Nodes (19): beans stripe connect, Docs: licence grants, Docs: Stripe connection modes, BILLING_STRIPE_*: us charging for hosted Cool Beans, CONNECT_STRIPE_*: Stripe Connect for cloud multi-vendor, Docs: Self-hosting, STRIPE_*: the vendor selling their software, The three Stripe namespaces (+11 more)

### Community 45 - "Rate Limit & Offline Activation Tests"
Cohesion: 0.14
Nodes (8): seeded(), markOverLimit(), PLAN_LIMITS, billingConfig, accountAtCap(), cloud, makeHarness(), testConfig()

### Community 46 - "Billing Subscription Service"
Cohesion: 0.22
Nodes (16): nowIso(), accountIdFromMetadata(), applySubscriptionState(), BillingEventOutcome, ensureSubscriptionRow(), findAccountByCustomerId(), findAccountBySubscriptionId(), getSubscriptionRow() (+8 more)

### Community 47 - "Console Admin Queries"
Cohesion: 0.19
Nodes (15): getAdminEmail(), formatDate(), message(), useInviteAdmin(), useOpenPortal(), useRevokeAdmin(), useStartCheckout(), useStartStripeConnect() (+7 more)

### Community 49 - "CLI HTTP Client"
Cohesion: 0.17
Nodes (11): apiRequest(), ClientOptions, resolveClient(), saved, parseEntitlementsFlag(), parseSeatsFlag(), ctx(), key (+3 more)

### Community 50 - "Accounts & Subscriptions Schema"
Cohesion: 0.13
Nodes (14): AccountSubscription, accountSubscriptions, NewAccountSubscription, Account, accounts, NewAccount, auditLog, AuditLogEntry (+6 more)

### Community 51 - "Activations & Revocations Schema"
Cohesion: 0.13
Nodes (14): Activation, activations, NewActivation, LicenseRevocation, licenseRevocations, License, licenses, NewLicense (+6 more)

### Community 52 - "Turborepo Pipeline"
Cohesion: 0.12
Nodes (17): ^build, dependsOn, outputs, cache, persistent, cache, dist/**, $schema (+9 more)

### Community 53 - "Billing Gateway"
Cohesion: 0.15
Nodes (11): ACCOUNT_METADATA_KEY, APP_METADATA_KEY, APP_METADATA_VALUE, BillingGateway, BillingSubscription, CheckoutArgs, createBillingGateway(), hostOf() (+3 more)

### Community 54 - "Shadcn Component Aliases"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 55 - "Console TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, jsx, lib, outDir, rootDir, types (+8 more)

### Community 56 - "Concurrency Rationale & Rescue Docs"
Cohesion: 0.16
Nodes (17): Unfulfilled payment one-click rescue, Docs: Stripe webhook event table, Atomicity needs locks, not just guarded statements, Never read a driver rowcount, PostgreSQL everywhere (one dialect), withTx transaction binding, X-CoolBeans-Signature HMAC verification, Activation limit and live-seat count (+9 more)

### Community 57 - "Database Client & Migrations"
Cohesion: 0.17
Nodes (15): affected(), AnyPgResult, applied(), assertSchemaCurrent(), CoolBeansDb, CoolBeansPool, createDb(), createPool() (+7 more)

### Community 58 - "Products & Icons Schema"
Cohesion: 0.18
Nodes (11): ProductIcon, productIcons, NewProduct, Product, products, NewSigningKey, SigningKey, signingKeys (+3 more)

### Community 59 - "Console App Bootstrap"
Cohesion: 0.12
Nodes (13): App(), queryClient, router, root, render(), consoleLayout, consoleRoutes, createConsoleRouter() (+5 more)

### Community 60 - "HTTP API & PRD Endpoint Docs"
Cohesion: 0.21
Nodes (16): Docs: HTTP API, Customer portal endpoints (lookup, recover, billing-session), Docs: LS parity routes, Component vocabulary (status pill, kind, meters, dialogs), POST /v1/activate, Clementine (first product, prefix CLEM), Customer portal, POST /v1/deactivate (+8 more)

### Community 61 - "Structured Logger"
Cohesion: 0.16
Nodes (8): consoleSink(), createLogger(), LEVEL_ORDER, Logger, LoggerOptions, LogLevel, LogRecord, LogSink

### Community 62 - "Journey Test Runner"
Cohesion: 0.16
Nodes (9): ADMIN, api(), client(), machine(), machines, publicApi(), unique, sendStripeWebhook() (+1 more)

### Community 63 - "API Dev Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, @coolbeans/sdk, @electric-sql/pglite, tsup, tsx, @types/node, typescript, vitest (+7 more)

### Community 64 - "Usage Metering"
Cohesion: 0.25
Nodes (13): withTx(), unknownInstance(), incrementBody, registerUsageRoutes(), applyResetIfDue(), getMetric(), getOrCreateCounter(), getUsage() (+5 more)

### Community 65 - "Billing & Tenancy Tests"
Cohesion: 0.17
Nodes (9): cloud, harness(), productToken(), withSession(), cloud, COVERED, twoAccounts(), cloud (+1 more)

### Community 66 - "Examples Package Manifest"
Cohesion: 0.13
Nodes (14): dependencies, @coolbeans/sdk, devDependencies, @types/node, typescript, @coolbeans/sdk, @types/node, typescript (+6 more)

### Community 67 - "Outbox & Column Helpers Schema"
Cohesion: 0.16
Nodes (11): isoNow, NewOutboxJob, outbox, OutboxJob, NewPendingRevocation, PendingRevocation, pendingRevocations, webhookDeliveries (+3 more)

### Community 69 - "Auth & Design Token Docs"
Cohesion: 0.15
Nodes (14): Embedded public keys are the trust anchor, When you need the product slug, Webhook endpoint admin API (register, rotate, deliveries), Bespoke email magic-code console auth, Auth screens (magic-code sign in), Color tokens (warm ink on white, lime accent), Cool Beans console design mockup, Cool Beans design system (v2) (+6 more)

### Community 70 - "App Factory & OpenAPI"
Cohesion: 0.22
Nodes (10): App, createApp(), toErrorResponse(), errors(), errorSchema, instanceSchema, jsonBody(), licenseSchema (+2 more)

### Community 71 - "Node Entry & Redis Store"
Cohesion: 0.17
Nodes (10): ClientRateLimitInfo, createRedisStore(), app, authRateLimit, db, deps, logger, pool (+2 more)

### Community 72 - "Console Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react, vitest, @types/react (+5 more)

### Community 73 - "SDK Unit Tests"
Cohesion: 0.23
Nodes (7): base64url(), signToken(), DecodedToken, decodeToken(), fromBase64Url(), TokenPayload, verifyTokenSignature()

### Community 74 - "SDK TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, lib, outDir, rootDir, types, extends, include, DOM (+4 more)

### Community 75 - "Postgres Atomicity Script"
Cohesion: 0.23
Nodes (9): here, liveLeases(), liveProducts(), postgres, require, resetProducts(), resetSeats(), seedLeaseContention() (+1 more)

### Community 76 - "Root TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, declarationMap, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution, resolveJsonModule (+4 more)

### Community 77 - "Self-Host Limits & Compose"
Cohesion: 0.24
Nodes (11): CI smoke job (docker compose smoke test), scripts/smoke-test.sh, Self-host is unlimited, api service (apps/api/dist/node.js), migrate service (one-shot migration runner), coolbeans-pgdata volume, postgres service (postgres:16-alpine), redis service (redis:7-alpine) (+3 more)

### Community 78 - "Marketing Deploy & PWA Shell"
Cohesion: 0.17
Nodes (12): Deploy www job (Cloudflare Pages), Manual Cloudflare Pages prerequisites, Hoist Cloudflare secrets into env so the deploy step skips cleanly, Cool Beans Console SPA shell, Google Fonts (Instrument Sans, IBM Plex Sans/Mono), Web manifest, favicons, and #c8ff4d theme color, pleasehold.dev architecture conventions, allowBuilds native postinstall allowlist (+4 more)

### Community 79 - "PayPal Gateway & Runtime"
Cohesion: 0.18
Nodes (6): resolveEmailSender(), createPayPalGateway(), PayPalConfig, PayPalEvent, PayPalGateway, PayPalVerifyInput

### Community 80 - "API TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, declarationMap, outDir, rootDir, types, extends, include (+3 more)

### Community 81 - "Worker TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, declarationMap, outDir, rootDir, types, extends, include (+3 more)

### Community 82 - "Examples TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, lib, noEmit, types, extends, include, DOM, ES2022 (+3 more)

### Community 83 - "CLI TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, declarationMap, outDir, rootDir, types, extends, include (+3 more)

### Community 84 - "Grants & Purchases Schema"
Cohesion: 0.20
Nodes (9): LicenseGrant, licenseGrants, NewLicenseGrant, NewPurchase, Purchase, purchases, NewStripeConnection, StripeConnection (+1 more)

### Community 85 - "CI & Deploy Jobs"
Cohesion: 0.18
Nodes (11): PR checklist (tests, test/check/typecheck, §9, concurrency flag), CI check job (install, build, check, test), Bare sha tag (prefix= strips sha-), Deploy build-and-push job (GHCR image), OCI source labels link GHCR package to repo, One image, three commands (api, worker, migrate Job), Deploy rollout job (GitOps kustomize image bump), Deploy verify job (check plus test on PGlite) (+3 more)

### Community 86 - "Stripe Gateway Factory"
Cohesion: 0.24
Nodes (9): ConnectedAccount, createStripeGateway(), hostOf(), portOf(), protocolOf(), SessionLineItem, StripeConnectResult, StripePriceInfo (+1 more)

### Community 87 - "API Build Config"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, declarationMap, emitDeclarationOnly, noEmit, exclude, extends, src/test/** (+2 more)

### Community 89 - "Offline Token Docs"
Cohesion: 0.25
Nodes (11): LS status mapping (trial expiry → expired), Air-gapped activation blob, The offline cutoff (three rules), Docs: Offline verification, The three offline states (valid / grace / expired), Offline token env reference (TTL, buffer, activation TTL), Offline activation for air-gapped machines, Ed25519 signed offline token (+3 more)

### Community 90 - "Email TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, jsx, outDir, rootDir, types, extends, include, node (+2 more)

### Community 91 - "Journey Package Manifest"
Cohesion: 0.18
Nodes (10): dependencies, @coolbeans/sdk, description, @coolbeans/sdk, name, private, scripts, journey (+2 more)

### Community 92 - "Worker Entry Point"
Cohesion: 0.24
Nodes (9): config, connection, db, deps, logger, pool, queue, shutdown() (+1 more)

### Community 93 - "Auth Build Config"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDeclarationOnly, noEmit, exclude, extends, src/test/**, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 94 - "Database TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, extends, include, node, src (+1 more)

### Community 95 - "Database Build Config"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDeclarationOnly, noEmit, exclude, extends, src/test/**, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 96 - "Email Build Config"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDeclarationOnly, noEmit, exclude, extends, src/test/**, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 97 - "Logger Build Config"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDeclarationOnly, noEmit, exclude, extends, src/test/**, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 98 - "SDK Build Config"
Cohesion: 0.20
Nodes (9): compilerOptions, emitDeclarationOnly, noEmit, exclude, extends, src/test/**, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 99 - "API Package Manifest"
Cohesion: 0.22
Nodes (8): exports, ./runtime, name, private, import, types, type, version

### Community 100 - "API Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, clean, dev, format, lint, test, test:race (+1 more)

### Community 101 - "Outbox Job Claiming"
Cohesion: 0.31
Nodes (8): claimDue(), DeliverWebhookPayload, JobKind, markDone(), markFailed(), processJob(), SendKeyEmailPayload, snakeJob()

### Community 102 - "Console Package Manifest"
Cohesion: 0.22
Nodes (8): imports, #components/*, #hooks/*, #lib/*, name, private, type, version

### Community 103 - "Console Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, clean, dev, format, lint, preview, test (+1 more)

### Community 104 - "Offline & Tenancy Ground Rules"
Cohesion: 0.25
Nodes (9): Shared key normalization (dashes stripped, uppercased), Offline-tolerant by contract (unknown key is 404, never disabled), requireProduct (account-scoped product resolution), Tenancy: cross-account is 404, never 403, Licence grant (price to duration, seats, entitlements), /v1/llms.txt agent integration brief, Signed ed25519 offline tokens, cb.open(licenseKey) single-call integration (+1 more)

### Community 105 - "Architecture References"
Cohesion: 0.25
Nodes (9): ISO-8601 string dates compared lexicographically, keygate domain reference (AGPL, ideas only), pleasehold.dev (sibling project conventions), Repo shape (pnpm workspaces + Turborepo), Retention policy for provider_events and audit_log, audit_log, §17 Data model (portable SQL), keygate (Go, AGPL reference project) (+1 more)

### Community 106 - "Smoke Test Script"
Cohesion: 0.22
Nodes (7): ADMIN_TOKEN, API_PORT, EMAIL_PROVIDER, POSTGRES_PASSWORD, smoke-test.sh script, SIGNING_KEY_SECRET, SMTP_HOST

### Community 107 - "Community Files"
Cohesion: 0.25
Nodes (8): Issue chooser contact links (docs, discussions, security advisory), Feature request form (problem before solution), Contributor Covenant 2.1, Code of Conduct enforcement (hello@coolbeans.tools), Code of Conduct pledge and standards, Dev setup (Node >= 22, pnpm 11), good first issue / help wanted labels, Private vulnerability reporting

### Community 108 - "Integration Brief Service"
Cohesion: 0.43
Nodes (5): BriefProduct, buildProductBrief(), isFloating(), seatModelWords(), KEYS

### Community 109 - "Dialog Primitives"
Cohesion: 0.43
Nodes (6): Dialog(), DialogContent(), DialogDescription(), DialogOverlay(), DialogPortal(), DialogTitle()

### Community 110 - "Outbound Webhook Docs"
Cohesion: 0.29
Nodes (8): beans product create, Docs: Outbound webhooks, Outbox drain with FOR UPDATE SKIP LOCKED, Webhook claim fence token, At-least-once delivery contract, Lifecycle event types (license.* / activation.*), Outbound webhooks, Floating (concurrent seat) licence model

### Community 111 - "Tenancy Rules Docs"
Cohesion: 0.29
Nodes (8): Three rules you cannot get wrong, No key import: parity is at the API level, ADMIN_TOKEN is unset in cloud on purpose, Account 1 always exists, Cross-account is 404, never 403, The public /v1 surface is never account-scoped, Tenancy decisions (accounts row is the tenant), Unknown key is 404, never disabled

### Community 112 - "Marketing TypeScript Config"
Cohesion: 0.25
Nodes (7): exclude, extends, include, dist, src/**/*, astro/tsconfigs/strict, .astro/types.d.ts

### Community 113 - "Auth TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.json

### Community 114 - "Logger TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.json

### Community 115 - "Journey Data Validation"
Cohesion: 0.25
Nodes (4): db, here, postgres, require

### Community 116 - "Credential & SQL Ground Rules"
Cohesion: 0.29
Nodes (7): Bug report form, Where are you running it dropdown (self-host, cloud, SDK only), Never paste a real licence key or admin token, The key is the credential, Portable SQL behind a storage adapter, The rules that are not up for debate, packages/db storage adapter

### Community 117 - "Plan Limit Tests"
Cohesion: 0.43
Nodes (5): accountAtLicenceCap(), cloud, freeAccount(), postProduct(), productBody()

### Community 118 - "Brand Icon Set"
Cohesion: 0.43
Nodes (7): Apple Touch Icon (Cool Beans Bean-in-Shades Mark, ~180px), Favicon 16px (Cool Beans Mark, smallest tab icon), Favicon 32px (Cool Beans Mark, browser tab icon), PWA Icon 192px (Cool Beans Mark, console home-screen icon), PWA Icon 512px (Cool Beans Mark at full detail: black coffee bean in sunglasses, smiling, on lime rounded square with two sparkles), Cool Beans Logo (admin console brand mark, same bean-in-shades artwork), Marketing Site Icon (identical bean-in-shades mark for apps/www)

### Community 119 - "Project Personas & Docs"
Cohesion: 0.29
Nodes (4): docs/ARCHITECTURE.md, Cool Beans (project charter), docs/PRD.md (full spec), Cool Beans license layer (README overview)

### Community 120 - "Admin Users Schema"
Cohesion: 0.29
Nodes (6): AdminSession, adminSessions, AdminUser, adminUsers, AuthCode, authCodes

### Community 122 - "End-to-End Test"
Cohesion: 0.47
Nodes (3): appFetch(), memStorage(), sdk()

### Community 123 - "Key Generation Spec Docs"
Cohesion: 0.33
Nodes (6): Rate limiting 30 req/min/IP on /v1/*, Migrations run in exactly one place, Deployment (compose self-host, k8s cloud), Key generation and normalization, §9 example vs §10 key length discrepancy, PRD validation matrix

### Community 124 - "Concurrency Review Rules"
Cohesion: 0.40
Nodes (6): Atomic limit enforcement, Codex review for concurrency changes, Webhook signature verification and two-way idempotency, Extra concurrency review before merge, HMAC-signed outbound webhooks, Usage metering with atomic quotas

### Community 125 - "Cloud & Connect Overview"
Cohesion: 0.33
Nodes (6): BILLING_* vs STRIPE_* separate namespaces, contract/access-states.json shared fixtures, Cloud at app.coolbeans.tools, Stripe Connect multi-vendor, coolbeans-swift SDK, Security scope (repo, hosted service, both SDKs)

### Community 126 - "Electron Example"
Cohesion: 0.33
Nodes (3): beans, file, shutdown()

### Community 127 - "Tauri Example"
Cohesion: 0.33
Nodes (3): beans, cache, writeQueue

### Community 128 - "Journey Shell Harness"
Cohesion: 0.60
Nodes (5): cleanup(), free_ports(), say(), journey.sh script, wait_for()

### Community 129 - "Race Test Setup"
Cohesion: 0.40
Nodes (3): PORT, ProvidedContext, vitest

### Community 132 - "Frozen Contract Rules"
Cohesion: 0.40
Nodes (5): Frozen §9 client API contract, test/limits-never-lock-out.test.ts, Plan limits never touch the frozen path, services/licensing.ts, Lemon Squeezy License API parity routes

### Community 134 - "Better Auth Factory"
Cohesion: 0.50
Nodes (3): Auth, AuthOptions, createAuth()

### Community 136 - "Stripe Mock Server"
Cohesion: 0.40
Nodes (3): port, server, state

### Community 140 - "Atomicity Script Entry"
Cohesion: 0.67
Nodes (3): cleanup(), PG_URL, atomicity.sh script

## Knowledge Gaps
- **779 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+774 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppDeps` connect `Product Admin Routes` to `Admin Route Registration`, `Admin Route Tests`, `HTTP Errors & LemonSqueezy Shapes`, `Key Generation & Normalization`, `Key Issuance Admin API`, `Console Static Mount`, `Config & Rate Limiting`, `Console Magic-Code Auth`, `Token Signing & Crypto`, `Public v1 Endpoints & Serializers`, `Connect Webhook & Event Pruning`, `Issuance & Payments Services`, `Event Ordering & Reconciliation`, `Licence Grants Service`, `Admin Auth Middleware`, `Team & Keyset Tests`, `Webhook Route Registration`, `Billing Subscription Service`, `Billing Gateway`, `Usage Metering`, `Stripe Gateway Interface`, `App Factory & OpenAPI`, `Node Entry & Redis Store`, `PayPal Gateway & Runtime`, `Outbox Job Claiming`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `nowDate()` connect `Connect Webhook & Event Pruning` to `Product Admin Routes`, `Admin Route Registration`, `Usage Metering`, `HTTP Errors & LemonSqueezy Shapes`, `Licence Grants Service`, `Outbox Job Claiming`, `Key Generation & Normalization`, `Key Issuance Admin API`, `Webhook Route Registration`, `Billing Subscription Service`, `Console Magic-Code Auth`, `Token Signing & Crypto`, `Public v1 Endpoints & Serializers`, `Issuance & Payments Services`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `makeHarness()` connect `Rate Limit & Offline Activation Tests` to `Billing & Tenancy Tests`, `Admin Route Tests`, `HTTP Errors & LemonSqueezy Shapes`, `Admin Auth Middleware`, `Team & Keyset Tests`, `Webhook Route Registration`, `Billing Isolation Tests`, `Console Static Mount`, `Stripe & Grants Route Tests`, `Key Generation & Normalization`, `App Factory & OpenAPI`, `Config & Rate Limiting`, `Token Signing & Crypto`, `Plan Limit Tests`, `Missed-Sale Rescue Tests`, `End-to-End Test`, `Issuance & Payments Services`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _779 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin Route Registration` be split into smaller, more focused modules?**
  _Cohesion score 0.11450980392156863 - nodes in this community are weakly interconnected._
- **Should `Email Package Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `Admin Route Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.12790697674418605 - nodes in this community are weakly interconnected._