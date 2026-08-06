# Graph Report - .  (2026-08-06)

## Corpus Check
- 389 files · ~273,840 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2424 nodes · 5116 edges · 168 communities (145 shown, 23 thin omitted)
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
- `Key generation and normalization` --semantically_similar_to--> `Customer portal endpoints (lookup, recover, billing-session)`  [INFERRED] [semantically similar]
  docs/PRD.md → apps/www/src/pages/docs/http-api.md
- `BILLING_* vs STRIPE_* separate namespaces` --shares_data_with--> `api service (apps/api/dist/node.js)`  [INFERRED]
  CLAUDE.md → docker-compose.yml
- `Codex review for concurrency changes` --semantically_similar_to--> `Extra concurrency review before merge`  [INFERRED] [semantically similar]
  CLAUDE.md → CONTRIBUTING.md
- `packages/db storage adapter` --references--> `migrate service (one-shot migration runner)`  [INFERRED]
  CONTRIBUTING.md → docker-compose.yml
- `Private vulnerability reporting` --semantically_similar_to--> `Code of Conduct enforcement (hello@coolbeans.tools)`  [INFERRED] [semantically similar]
  SECURITY.md → CODE_OF_CONDUCT.md

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
Nodes (42): forbidden(), notFound(), validationError(), registerAdminBillingRoutes(), registerAdminRoutes(), registerAdminProductRoutes(), rescueBody, registerAdminRescueRoutes() (+34 more)

### Community 1 - "Email Package Dependencies"
Cohesion: 0.04
Nodes (44): name, private, version, type, description, main, types, exports (+36 more)

### Community 2 - "Admin Route Tests"
Cohesion: 0.13
Nodes (13): drainOutbox(), record(), seedLicense(), TestHarness, cloud, overEveryLimit(), rawExec(), seedGrant() (+5 more)

### Community 3 - "HTTP Errors & LemonSqueezy Shapes"
Cohesion: 0.12
Nodes (36): ErrorBody, ApiError, invalidKey(), unknownKey(), licenseDisabled(), activationLimitReached(), conflict(), lsLicenseKey() (+28 more)

### Community 4 - "Console Data Queries"
Cohesion: 0.08
Nodes (34): NAMED_VERBS, actionVerb(), formatDetail(), detailHighlight(), EntitlementMap, useRecentLicenses(), TeamMember, UsageRow (+26 more)

### Community 5 - "Console Query Hooks & Price Labels"
Cohesion: 0.11
Nodes (29): api(), priceName(), priceAmount(), useLicenses(), useIconVersion(), bumpIconVersion(), StripePriceRow, useStripePrices() (+21 more)

### Community 6 - "Database Package Dependencies"
Cohesion: 0.05
Nodes (38): name, private, version, type, main, types, exports, files (+30 more)

### Community 7 - "Key Generation & Normalization"
Cohesion: 0.13
Nodes (23): ALPHABET, ALPHABET_SET, drawSymbols(), generateKeyBody(), generateKey(), normalizedKey(), ParsedKey, parseKey() (+15 more)

### Community 8 - "Key Issuance Admin API"
Cohesion: 0.11
Nodes (29): planLimitReached(), csvRow(), COLUMNS, registerAdminExportRoutes(), RFC-4180, offlineActivationBody, extendBody, issueBody (+21 more)

### Community 9 - "Worker Package Dependencies"
Cohesion: 0.05
Nodes (36): name, private, version, type, scripts, dev, build, lint (+28 more)

### Community 10 - "Stripe & Grants Route Tests"
Cohesion: 0.07
Nodes (9): CATALOG, BASIC, PRO, ADMIN, PROVIDER_EVENT_RETENTION_DAYS, tablesToTruncate(), reset(), testDatabase() (+1 more)

### Community 11 - "Console UI Primitives"
Cohesion: 0.10
Nodes (27): ConsoleLayout(), Dialog(), Shell(), CardHeader(), StatusPill(), KindText(), InkButton(), SecondaryButton() (+19 more)

### Community 12 - "Console Shell & Navigation"
Cohesion: 0.10
Nodes (27): ICONS, NAV, BILLING_NAV, TITLES, ScopeSwitcher(), AppSidebar(), HeaderSearch(), Card() (+19 more)

### Community 13 - "Auth Package Dependencies"
Cohesion: 0.06
Nodes (33): name, private, version, type, main, types, exports, files (+25 more)

### Community 14 - "CLI Package Dependencies"
Cohesion: 0.06
Nodes (32): name, version, type, description, license, bin, beans, main (+24 more)

### Community 16 - "Config & Rate Limiting"
Cohesion: 0.09
Nodes (15): base, Config, ConfigError, requireVar(), loadConfig(), clientKey(), RateLimitOptions, ipRateLimiter() (+7 more)

### Community 17 - "Console Magic-Code Auth"
Cohesion: 0.12
Nodes (28): requestBody, verifyBody, readBody(), registerAuthRoutes(), sha256(), hashesEqual(), normalizeEmail(), RequestCodeResult (+20 more)

### Community 18 - "Token Signing & Crypto"
Cohesion: 0.16
Nodes (23): deriveKey(), encryptSecret(), decryptSecret(), TokenPayload, SigningKeyPair, b64url(), generateSigningKeyPair(), privateKeyObject() (+15 more)

### Community 19 - "Public v1 Endpoints & Serializers"
Cohesion: 0.13
Nodes (25): toDisplayKey(), LicenseObject, InstanceObject, serializeLicense(), serializeInstance(), activateBody, keysetBody, validateBody (+17 more)

### Community 20 - "Console Integration Brief"
Cohesion: 0.13
Nodes (24): KEYS, ConfigFact, EndpointFact, Snippet, SnippetTarget, HOSTED_BASE_URL, isFloating(), briefUrl() (+16 more)

### Community 21 - "Marketing Site Dependencies"
Cohesion: 0.07
Nodes (28): name, private, version, type, scripts, dev, build, preview (+20 more)

### Community 22 - "Docs Site Concepts"
Cohesion: 0.11
Nodes (29): Offline-tolerant by contract, @coolbeans/sdk one-call open(), AccessState verdict (allow/deny discriminated union), Signed entitlements (flat map of scalars), The frozen contract (architecture view), contract/access-states.json shared fixtures, Ed25519 offline tokens, never HMAC, Never gate a feature on webhook arrival (+21 more)

### Community 23 - "Console Dialogs"
Cohesion: 0.14
Nodes (20): Field(), inputClass, KIND_HINTS, IssueKeyDialog(), OfflineActivationDialog(), AccentButton(), deviceLabel(), ParsedEntitlements (+12 more)

### Community 24 - "Sidebar Component"
Cohesion: 0.08
Nodes (8): SidebarContextProps, SidebarContext, useSidebar(), Sidebar(), SidebarTrigger(), SidebarRail(), sidebarMenuButtonVariants, SidebarMenuButton()

### Community 25 - "Root Workspace Tooling"
Cohesion: 0.07
Nodes (27): name, private, version, type, description, license, packageManager, engines (+19 more)

### Community 26 - "SDK Package Manifest"
Cohesion: 0.07
Nodes (27): name, version, type, description, license, main, types, exports (+19 more)

### Community 27 - "Connect Webhook & Event Pruning"
Cohesion: 0.22
Nodes (21): nowDate(), eventAccount(), registerConnectWebhook(), pruneProviderEvents(), createCloudConnection(), disconnectConnection(), hashState(), publicUrlFor() (+13 more)

### Community 28 - "Biome Lint Config"
Cohesion: 0.08
Nodes (25): $schema, files, includes, **, !**/*.css, formatter, enabled, indentStyle (+17 more)

### Community 29 - "Logger Package Manifest"
Cohesion: 0.08
Nodes (25): name, private, version, type, description, main, types, exports (+17 more)

### Community 30 - "Issuance & Payments Services"
Cohesion: 0.18
Nodes (21): Kind, createPurchase(), enqueue(), EnsureArgs, EnsureResult, ensureLicense(), ClaimResult, Claim (+13 more)

### Community 31 - "SDK Contract Fixture Tests"
Cohesion: 0.15
Nodes (17): CANONICAL, SWIFT_COPY, TokenSpec, ContractCase, contract, T0, signed(), blob() (+9 more)

### Community 32 - "Product Admin Routes"
Cohesion: 0.15
Nodes (16): AppDeps, createProductBody, iconBody, metricBody, WebhookContext, ICON_MAX_BYTES, ICON_MIMES, sniffImageMime() (+8 more)

### Community 33 - "Event Ordering & Reconciliation"
Cohesion: 0.19
Nodes (19): shouldApplySubscriptionEvent(), lastSubscriptionEventAt(), markSubscriptionEventApplied(), dropPendingRevocation(), LAPSED_SUBSCRIPTION_STATUSES, PAYING_SUBSCRIPTION_STATUSES, num(), sessionIsPaid() (+11 more)

### Community 34 - "Console Webhook Queries"
Cohesion: 0.16
Nodes (18): formatDateTime(), useProviderEvents(), WebhookEndpoint, useWebhookEventTypes(), useWebhookEndpoints(), useWebhookDeliveries(), useCreateWebhookEndpoint(), useRotateWebhookSecret() (+10 more)

### Community 35 - "Email Sender Seam"
Cohesion: 0.14
Nodes (14): OutgoingEmail, EmailSender, email, createResendSender(), createConsoleSender(), SmtpOptions, createSmtpSender(), BrandHeader() (+6 more)

### Community 36 - "Licence Grants Service"
Cohesion: 0.21
Nodes (18): badRequest(), grantBody, registerAdminGrantRoutes(), assertNotBillingPrice(), CreateGrantArgs, priceLookupFailureMessage(), resolveKindForPrice(), entitlementsToStore() (+10 more)

### Community 37 - "Admin Auth Middleware"
Cohesion: 0.22
Nodes (17): unauthorized(), safeEqual(), isAdminRequest(), adminAuth(), PRODUCT_SCOPED, scopeAllows(), accountForAdminToken(), consoleAuth() (+9 more)

### Community 38 - "Team & Keyset Tests"
Cohesion: 0.12
Nodes (6): lastCode(), req(), signIn(), fakeClock, fakePayPalGateway(), CapturedLine

### Community 39 - "Webhook Route Registration"
Cohesion: 0.19
Nodes (16): registerBillingWebhook(), registerWebhookRoutes(), registerPayPalWebhook(), process(), registerStripeWebhook(), BILLING_PROVIDER, foreignAppOf(), EVENT (+8 more)

### Community 40 - "Billing Isolation Tests"
Cohesion: 0.15
Nodes (12): cloud, harness(), bothConfigured, harness(), cloud, harness(), proSubscription(), send() (+4 more)

### Community 41 - "SDK Access State Types"
Cohesion: 0.11
Nodes (15): LicenseObject, InstanceObject, Storage, CoolBeansOptions, OfflineState, AllowReason, DenyReason, AccessState (+7 more)

### Community 42 - "API Package Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @coolbeans/auth, @coolbeans/auth, @coolbeans/db, @coolbeans/db, @coolbeans/email, @coolbeans/email, @hono/node-server (+11 more)

### Community 43 - "Console UI Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, @tanstack/react-router, @tanstack/react-router, @tanstack/react-table, @tanstack/react-table, class-variance-authority, class-variance-authority, clsx (+11 more)

### Community 44 - "Payments & Stripe Namespace Docs"
Cohesion: 0.13
Nodes (19): Stripe connection (self_host_default | cloud_connect), GET /v1/purchase/session/:checkout_session_id, Key delivery (success page + email), Multi-tenant accounts model, Pricing: self-host free, Cloud Free, Cloud Pro $99/yr flat, Keygen (Fair Source incumbent), Platform billing as the single cloud-mode flag, BILLING_* separate from STRIPE_* (four isolation layers) (+11 more)

### Community 45 - "Rate Limit & Offline Activation Tests"
Cohesion: 0.14
Nodes (8): seeded(), billingConfig, PLAN_LIMITS, markOverLimit(), cloud, accountAtCap(), testConfig(), makeHarness()

### Community 46 - "Billing Subscription Service"
Cohesion: 0.22
Nodes (16): nowIso(), PAYING_STATUSES, getSubscriptionRow(), ensureSubscriptionRow(), patchSubscription(), setCustomerId(), setPlan(), findAccountByCustomerId() (+8 more)

### Community 47 - "Console Admin Queries"
Cohesion: 0.19
Nodes (15): getAdminEmail(), formatDate(), message(), useTeam(), useInviteAdmin(), useRevokeAdmin(), useStartStripeConnect(), useStartCheckout() (+7 more)

### Community 49 - "CLI HTTP Client"
Cohesion: 0.17
Nodes (11): saved, ClientOptions, resolveClient(), apiRequest(), parseEntitlementsFlag(), parseSeatsFlag(), program, ctx() (+3 more)

### Community 50 - "Accounts & Subscriptions Schema"
Cohesion: 0.13
Nodes (14): accountSubscriptions, AccountSubscription, NewAccountSubscription, accounts, Account, NewAccount, providerEvents, auditLog (+6 more)

### Community 51 - "Activations & Revocations Schema"
Cohesion: 0.13
Nodes (14): activations, Activation, NewActivation, licenseRevocations, LicenseRevocation, licenses, License, NewLicense (+6 more)

### Community 52 - "Turborepo Pipeline"
Cohesion: 0.12
Nodes (17): $schema, tasks, build, dependsOn, ^build, outputs, dist/**, dev (+9 more)

### Community 53 - "Billing Gateway"
Cohesion: 0.15
Nodes (11): CheckoutArgs, BillingSubscription, BillingGateway, hostOf(), portOf(), protocolOf(), ACCOUNT_METADATA_KEY, APP_METADATA_KEY (+3 more)

### Community 54 - "Shadcn Component Aliases"
Cohesion: 0.12
Nodes (16): $schema, style, rsc, tsx, tailwind, config, css, baseColor (+8 more)

### Community 55 - "Console TypeScript Config"
Cohesion: 0.12
Nodes (16): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, declaration, declarationMap, jsx (+8 more)

### Community 56 - "Concurrency Rationale & Rescue Docs"
Cohesion: 0.16
Nodes (17): Activation limit and live-seat count, Atomic limit enforcement in the database, Perpetual licence kind, License grant (one Stripe price to one product), POST /v1/stripe/webhook event handling, PayPal adapter (second provider), Two-layer webhook idempotency, PostgreSQL everywhere (one dialect) (+9 more)

### Community 57 - "Database Client & Migrations"
Cohesion: 0.17
Nodes (15): AnyPgResult, CoolBeansDb, DbHandle, CoolBeansPool, createPool(), createDb(), MIGRATIONS_FOLDER, migrate() (+7 more)

### Community 58 - "Products & Icons Schema"
Cohesion: 0.18
Nodes (11): productIcons, ProductIcon, products, Product, NewProduct, signingKeys, SigningKey, NewSigningKey (+3 more)

### Community 59 - "Console App Bootstrap"
Cohesion: 0.12
Nodes (13): queryClient, router, App(), root, render(), rootRoute, portalRoute, consoleLayout (+5 more)

### Community 60 - "HTTP API & PRD Endpoint Docs"
Cohesion: 0.21
Nodes (16): §9 Public Client API (Frozen Contract), The license object (key,status,kind,plan,product,expires_at), POST /v1/activate, POST /v1/validate, POST /v1/deactivate, POST /v1/heartbeat (floating lease renew), POST /v1/usage/increment, GET /v1/usage (+8 more)

### Community 61 - "Structured Logger"
Cohesion: 0.16
Nodes (8): LogLevel, LogRecord, LogSink, LoggerOptions, Logger, LEVEL_ORDER, consoleSink(), createLogger()

### Community 62 - "Journey Test Runner"
Cohesion: 0.16
Nodes (9): ADMIN, api(), publicApi(), machine(), client(), unique, machines, stripeSignature() (+1 more)

### Community 63 - "API Dev Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, @coolbeans/sdk, @coolbeans/sdk, @electric-sql/pglite, @electric-sql/pglite, @types/node, @types/node, tsup (+7 more)

### Community 64 - "Usage Metering"
Cohesion: 0.25
Nodes (13): withTx(), unknownInstance(), incrementBody, registerUsageRoutes(), UsageState, IncrementResult, nextReset(), getMetric() (+5 more)

### Community 65 - "Billing & Tenancy Tests"
Cohesion: 0.17
Nodes (9): cloud, harness(), withSession(), productToken(), cloud, twoAccounts(), COVERED, cloud (+1 more)

### Community 66 - "Examples Package Manifest"
Cohesion: 0.13
Nodes (14): name, private, version, type, scripts, typecheck, dependencies, @coolbeans/sdk (+6 more)

### Community 67 - "Outbox & Column Helpers Schema"
Cohesion: 0.16
Nodes (11): isoNow, outbox, OutboxJob, NewOutboxJob, pendingRevocations, PendingRevocation, NewPendingRevocation, webhookEndpoints (+3 more)

### Community 69 - "Auth & Design Token Docs"
Cohesion: 0.15
Nodes (14): POST /v1/keyset, The key is the credential, Admin API, dashboard and CLI, Per-product signing keys with rotation, Bespoke email magic-code console auth, Cool Beans design system (v2), Color tokens (warm ink on white, lime accent), Type scale (Instrument Sans + IBM Plex Mono) (+6 more)

### Community 70 - "App Factory & OpenAPI"
Cohesion: 0.22
Nodes (10): createApp(), App, toErrorResponse(), licenseSchema, errorSchema, instanceSchema, jsonBody(), errors() (+2 more)

### Community 71 - "Node Entry & Redis Store"
Cohesion: 0.17
Nodes (10): ClientRateLimitInfo, createRedisStore(), logger, pool, db, rateLimit, authRateLimit, deps (+2 more)

### Community 72 - "Console Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, @types/react, @types/react, @types/react-dom, @types/react-dom, @vitejs/plugin-react, @vitejs/plugin-react, typescript (+5 more)

### Community 73 - "SDK Unit Tests"
Cohesion: 0.23
Nodes (7): base64url(), signToken(), TokenPayload, fromBase64Url(), DecodedToken, decodeToken(), verifyTokenSignature()

### Community 74 - "SDK TypeScript Config"
Cohesion: 0.15
Nodes (12): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, lib, ES2022, DOM (+4 more)

### Community 75 - "Postgres Atomicity Script"
Cohesion: 0.23
Nodes (9): here, require, postgres, sql, resetSeats(), seedLeaseContention(), liveLeases(), resetProducts() (+1 more)

### Community 76 - "Root TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, target, module, moduleResolution, strict, isolatedModules, verbatimModuleSyntax, resolveJsonModule (+4 more)

### Community 77 - "Self-Host Limits & Compose"
Cohesion: 0.24
Nodes (11): Self-host is unlimited, Self-host (docker compose, PostgreSQL 16), Supported versions (main plus latest release), CI smoke job (docker compose smoke test), scripts/smoke-test.sh, postgres service (postgres:16-alpine), redis service (redis:7-alpine), migrate service (one-shot migration runner) (+3 more)

### Community 78 - "Marketing Deploy & PWA Shell"
Cohesion: 0.17
Nodes (12): pleasehold.dev architecture conventions, Repo layout (apps, packages, contract, docs, examples), Admin console, customer portal, beans CLI, Deploy www job (Cloudflare Pages), Hoist Cloudflare secrets into env so the deploy step skips cleanly, Manual Cloudflare Pages prerequisites, Cool Beans Console SPA shell, Google Fonts (Instrument Sans, IBM Plex Sans/Mono) (+4 more)

### Community 79 - "PayPal Gateway & Runtime"
Cohesion: 0.18
Nodes (6): resolveEmailSender(), PayPalEvent, PayPalVerifyInput, PayPalGateway, PayPalConfig, createPayPalGateway()

### Community 80 - "API TypeScript Config"
Cohesion: 0.17
Nodes (11): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, declaration, declarationMap, types (+3 more)

### Community 81 - "Worker TypeScript Config"
Cohesion: 0.17
Nodes (11): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, declaration, declarationMap, types (+3 more)

### Community 82 - "Examples TypeScript Config"
Cohesion: 0.17
Nodes (11): extends, ../tsconfig.json, compilerOptions, noEmit, types, node, lib, ES2022 (+3 more)

### Community 83 - "CLI TypeScript Config"
Cohesion: 0.17
Nodes (11): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, declaration, declarationMap, types (+3 more)

### Community 84 - "Grants & Purchases Schema"
Cohesion: 0.20
Nodes (9): licenseGrants, LicenseGrant, NewLicenseGrant, purchases, Purchase, NewPurchase, stripeConnections, StripeConnection (+1 more)

### Community 85 - "CI & Deploy Jobs"
Cohesion: 0.18
Nodes (11): Tests run against PGlite (no database install needed), Tests come with the change (TDD), CI check job (install, build, check, test), Deploy verify job (check plus test on PGlite), Deploy build-and-push job (GHCR image), Deploy rollout job (GitOps kustomize image bump), OCI source labels link GHCR package to repo, Bare sha tag (prefix= strips sha-) (+3 more)

### Community 86 - "Stripe Gateway Factory"
Cohesion: 0.24
Nodes (9): StripeConnectResult, StripePriceInfo, StripePriceListing, SessionLineItem, ConnectedAccount, hostOf(), portOf(), protocolOf() (+1 more)

### Community 87 - "API Build Config"
Cohesion: 0.18
Nodes (10): extends, ./tsconfig.json, compilerOptions, declaration, declarationMap, emitDeclarationOnly, noEmit, exclude (+2 more)

### Community 89 - "Offline Token Docs"
Cohesion: 0.25
Nodes (11): Ed25519 signed offline token, OFFLINE_TOKEN_BUFFER_DAYS renewal buffer, Offline activation for air-gapped machines, Trial licence kind, Subscription licence kind, Docs: Offline verification, The three offline states (valid / grace / expired), The offline cutoff (three rules) (+3 more)

### Community 90 - "Email TypeScript Config"
Cohesion: 0.18
Nodes (10): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, jsx, types, node (+2 more)

### Community 91 - "Journey Package Manifest"
Cohesion: 0.18
Nodes (10): name, private, version, type, description, scripts, journey, dependencies (+2 more)

### Community 92 - "Worker Entry Point"
Cohesion: 0.24
Nodes (9): logger, config, pool, db, deps, connection, queue, worker (+1 more)

### Community 93 - "Auth Build Config"
Cohesion: 0.20
Nodes (9): extends, ./tsconfig.json, compilerOptions, emitDeclarationOnly, noEmit, exclude, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 94 - "Database TypeScript Config"
Cohesion: 0.20
Nodes (9): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, types, node, include (+1 more)

### Community 95 - "Database Build Config"
Cohesion: 0.20
Nodes (9): extends, ./tsconfig.json, compilerOptions, emitDeclarationOnly, noEmit, exclude, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 96 - "Email Build Config"
Cohesion: 0.20
Nodes (9): extends, ./tsconfig.json, compilerOptions, emitDeclarationOnly, noEmit, exclude, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 97 - "Logger Build Config"
Cohesion: 0.20
Nodes (9): extends, ./tsconfig.json, compilerOptions, emitDeclarationOnly, noEmit, exclude, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 98 - "SDK Build Config"
Cohesion: 0.20
Nodes (9): extends, ./tsconfig.json, compilerOptions, emitDeclarationOnly, noEmit, exclude, **/*.test.ts, **/*.test.tsx (+1 more)

### Community 99 - "API Package Manifest"
Cohesion: 0.22
Nodes (8): name, private, version, type, exports, ./runtime, types, import

### Community 100 - "API Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, dev, build, lint, format, typecheck, test, clean (+1 more)

### Community 101 - "Outbox Job Claiming"
Cohesion: 0.31
Nodes (8): JobKind, SendKeyEmailPayload, DeliverWebhookPayload, claimDue(), snakeJob(), markDone(), markFailed(), processJob()

### Community 102 - "Console Package Manifest"
Cohesion: 0.22
Nodes (8): name, private, version, type, imports, #components/*, #hooks/*, #lib/*

### Community 103 - "Console Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, dev, build, preview, lint, format, typecheck, test (+1 more)

### Community 104 - "Offline & Tenancy Ground Rules"
Cohesion: 0.25
Nodes (9): Offline-tolerant by contract (unknown key is 404, never disabled), Shared key normalization (dashes stripped, uppercased), Tenancy: cross-account is 404, never 403, requireProduct (account-scoped product resolution), cb.open(licenseKey) single-call integration, Licence grant (price to duration, seats, entitlements), Signed ed25519 offline tokens, /v1/llms.txt agent integration brief (+1 more)

### Community 105 - "Architecture References"
Cohesion: 0.25
Nodes (9): provider_events table, audit_log, §17 Data model (portable SQL), keygate (Go, AGPL reference project), ISO-8601 string dates compared lexicographically, Retention policy for provider_events and audit_log, Repo shape (pnpm workspaces + Turborepo), pleasehold.dev (sibling project conventions) (+1 more)

### Community 106 - "Smoke Test Script"
Cohesion: 0.22
Nodes (7): smoke-test.sh script, ADMIN_TOKEN, SIGNING_KEY_SECRET, POSTGRES_PASSWORD, API_PORT, EMAIL_PROVIDER, SMTP_HOST

### Community 107 - "Community Files"
Cohesion: 0.25
Nodes (8): Dev setup (Node >= 22, pnpm 11), good first issue / help wanted labels, Private vulnerability reporting, Code of Conduct pledge and standards, Code of Conduct enforcement (hello@coolbeans.tools), Contributor Covenant 2.1, Issue chooser contact links (docs, discussions, security advisory), Feature request form (problem before solution)

### Community 108 - "Integration Brief Service"
Cohesion: 0.43
Nodes (5): KEYS, BriefProduct, isFloating(), seatModelWords(), buildProductBrief()

### Community 109 - "Dialog Primitives"
Cohesion: 0.43
Nodes (6): Dialog(), DialogPortal(), DialogOverlay(), DialogContent(), DialogTitle(), DialogDescription()

### Community 110 - "Outbound Webhook Docs"
Cohesion: 0.29
Nodes (8): Floating (concurrent seat) licence model, Webhook claim fence token, Outbox drain with FOR UPDATE SKIP LOCKED, Outbound webhooks, Lifecycle event types (license.* / activation.*), At-least-once delivery contract, Docs: Outbound webhooks, beans product create

### Community 111 - "Tenancy Rules Docs"
Cohesion: 0.29
Nodes (8): Unknown key is 404, never disabled, Tenancy decisions (accounts row is the tenant), Cross-account is 404, never 403, The public /v1 surface is never account-scoped, Account 1 always exists, Three rules you cannot get wrong, ADMIN_TOKEN is unset in cloud on purpose, No key import: parity is at the API level

### Community 112 - "Marketing TypeScript Config"
Cohesion: 0.25
Nodes (7): extends, astro/tsconfigs/strict, include, .astro/types.d.ts, src/**/*, exclude, dist

### Community 113 - "Auth TypeScript Config"
Cohesion: 0.25
Nodes (7): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, include, src

### Community 114 - "Logger TypeScript Config"
Cohesion: 0.25
Nodes (7): extends, ../../tsconfig.json, compilerOptions, outDir, rootDir, include, src

### Community 115 - "Journey Data Validation"
Cohesion: 0.25
Nodes (4): here, require, postgres, db

### Community 116 - "Credential & SQL Ground Rules"
Cohesion: 0.29
Nodes (7): The key is the credential, Portable SQL behind a storage adapter, The rules that are not up for debate, packages/db storage adapter, Bug report form, Where are you running it dropdown (self-host, cloud, SDK only), Never paste a real licence key or admin token

### Community 117 - "Plan Limit Tests"
Cohesion: 0.43
Nodes (5): cloud, freeAccount(), productBody(), postProduct(), accountAtLicenceCap()

### Community 118 - "Brand Icon Set"
Cohesion: 0.43
Nodes (7): Apple Touch Icon (Cool Beans Bean-in-Shades Mark, ~180px), Favicon 16px (Cool Beans Mark, smallest tab icon), Favicon 32px (Cool Beans Mark, browser tab icon), PWA Icon 192px (Cool Beans Mark, console home-screen icon), PWA Icon 512px (Cool Beans Mark at full detail: black coffee bean in sunglasses, smiling, on lime rounded square with two sparkles), Cool Beans Logo (admin console brand mark, same bean-in-shades artwork), Marketing Site Icon (identical bean-in-shades mark for apps/www)

### Community 119 - "Project Personas & Docs"
Cohesion: 0.50
Nodes (4): Cool Beans (project charter), docs/PRD.md (full spec), docs/ARCHITECTURE.md, Cool Beans license layer (README overview)

### Community 120 - "Admin Users Schema"
Cohesion: 0.29
Nodes (6): adminUsers, authCodes, adminSessions, AdminUser, AuthCode, AdminSession

### Community 122 - "End-to-End Test"
Cohesion: 0.47
Nodes (3): appFetch(), memStorage(), sdk()

### Community 123 - "Key Generation Spec Docs"
Cohesion: 0.33
Nodes (6): Key generation and normalization, Deployment (compose self-host, k8s cloud), Migrations run in exactly one place, PRD validation matrix, §9 example vs §10 key length discrepancy, Rate limiting 30 req/min/IP on /v1/*

### Community 124 - "Concurrency Review Rules"
Cohesion: 0.40
Nodes (6): Atomic limit enforcement, Webhook signature verification and two-way idempotency, Codex review for concurrency changes, Extra concurrency review before merge, Usage metering with atomic quotas, HMAC-signed outbound webhooks

### Community 125 - "Cloud & Connect Overview"
Cohesion: 0.33
Nodes (6): BILLING_* vs STRIPE_* separate namespaces, Cloud at app.coolbeans.tools, Stripe Connect multi-vendor, contract/access-states.json shared fixtures, coolbeans-swift SDK, Security scope (repo, hosted service, both SDKs)

### Community 126 - "Electron Example"
Cohesion: 0.33
Nodes (3): file, beans, shutdown()

### Community 127 - "Tauri Example"
Cohesion: 0.33
Nodes (3): cache, writeQueue, beans

### Community 128 - "Journey Shell Harness"
Cohesion: 0.60
Nodes (5): journey.sh script, say(), wait_for(), free_ports(), cleanup()

### Community 129 - "Race Test Setup"
Cohesion: 0.40
Nodes (3): PORT, vitest, ProvidedContext

### Community 132 - "Frozen Contract Rules"
Cohesion: 0.40
Nodes (5): Frozen §9 client API contract, Plan limits never touch the frozen path, services/licensing.ts, test/limits-never-lock-out.test.ts, Lemon Squeezy License API parity routes

### Community 134 - "Better Auth Factory"
Cohesion: 0.50
Nodes (3): AuthOptions, createAuth(), Auth

### Community 136 - "Stripe Mock Server"
Cohesion: 0.40
Nodes (3): state, server, port

### Community 140 - "Atomicity Script Entry"
Cohesion: 0.67
Nodes (3): atomicity.sh script, PG_URL, cleanup()

## Knowledge Gaps
- **776 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+771 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppDeps` connect `Product Admin Routes` to `Admin Route Registration`, `Admin Route Tests`, `HTTP Errors & LemonSqueezy Shapes`, `Key Generation & Normalization`, `Key Issuance Admin API`, `Console Static Mount`, `Config & Rate Limiting`, `Console Magic-Code Auth`, `Token Signing & Crypto`, `Public v1 Endpoints & Serializers`, `Connect Webhook & Event Pruning`, `Issuance & Payments Services`, `Event Ordering & Reconciliation`, `Licence Grants Service`, `Admin Auth Middleware`, `Team & Keyset Tests`, `Webhook Route Registration`, `Billing Subscription Service`, `Billing Gateway`, `Usage Metering`, `Stripe Gateway Interface`, `App Factory & OpenAPI`, `Node Entry & Redis Store`, `PayPal Gateway & Runtime`, `Outbox Job Claiming`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `nowDate()` connect `Connect Webhook & Event Pruning` to `Product Admin Routes`, `Admin Route Registration`, `Usage Metering`, `HTTP Errors & LemonSqueezy Shapes`, `Licence Grants Service`, `Outbox Job Claiming`, `Key Generation & Normalization`, `Key Issuance Admin API`, `Webhook Route Registration`, `Billing Subscription Service`, `Console Magic-Code Auth`, `Token Signing & Crypto`, `Public v1 Endpoints & Serializers`, `Issuance & Payments Services`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `makeHarness()` connect `Rate Limit & Offline Activation Tests` to `Billing & Tenancy Tests`, `Admin Route Tests`, `HTTP Errors & LemonSqueezy Shapes`, `Admin Auth Middleware`, `App Factory & OpenAPI`, `Team & Keyset Tests`, `Billing Isolation Tests`, `Console Static Mount`, `Stripe & Grants Route Tests`, `Webhook Route Registration`, `Key Generation & Normalization`, `Config & Rate Limiting`, `Token Signing & Crypto`, `Plan Limit Tests`, `Missed-Sale Rescue Tests`, `End-to-End Test`, `Issuance & Payments Services`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _776 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin Route Registration` be split into smaller, more focused modules?**
  _Cohesion score 0.11450980392156863 - nodes in this community are weakly interconnected._
- **Should `Email Package Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._
- **Should `Admin Route Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.12790697674418605 - nodes in this community are weakly interconnected._