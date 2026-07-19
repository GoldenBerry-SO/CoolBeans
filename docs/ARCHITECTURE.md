# Cool Beans — Architecture notes

How this repo is put together and why. The product spec is [`PRD.md`](PRD.md); this doc records the
engineering decisions, most of them borrowed from two references:

- **pleasehold.dev** (sibling repo): repo structure, tooling, and Hono conventions.
- **keygate** (`temporal/keygate`, gitignored clone of https://github.com/tabloy/keygate): domain
  design for a license service. It's AGPL — we copy ideas, never code.

## Repo shape (from pleasehold.dev)

pnpm workspaces + Turborepo. `apps/api` is the Hono service; `apps/web` is the React SPA for the
admin dashboard (Vite + TanStack Router, mirroring pleasehold's `apps/web`; in production the API
serves its built assets); `apps/worker` is the BullMQ background-job processor (mirroring
pleasehold's worker); `packages/db` holds the Drizzle schema and storage adapter; `packages/auth`
wraps Better Auth (unused for now — see below); `packages/email` holds the React Email templates
and the Resend/SMTP sender seam; `packages/logger` is our own small structured logger (zero deps);
`packages/cli` is the `beans` admin CLI; `packages/sdk` is the publishable client. Conventions carried over wholesale:

- **Biome** (tabs, single quotes, lineWidth 100), per-package `lint`/`format`/`typecheck`/`test`
  scripts, husky pre-commit running `pnpm run check`.
- **ABOUTME headers**: every source file opens with two `// ABOUTME:` comment lines.
- **Console auth is a bespoke email magic-code flow**, not Better Auth: six digits, hashed at rest,
  10-minute TTL, 5-attempt cap. On self-host the first sign-in bootstraps the instance; in cloud mode
  any valid address can sign up and gets its own account. Multi-tenancy was added by hand rather than
  by adopting Better Auth's organization support — that would have meant importing its user/session
  tables alongside `admin_users`, migrating live sessions, and rewriting the magic-code flow, where
  what tenancy actually needed was one integer column on three tables. `packages/auth` remains unused
  and is a candidate for deletion unless SSO lands.
- **Response envelope**: success bodies carry `ok: true` (the PRD §9 contract shape); errors are
  `{ "ok": false, "error": "<code>", "message": "<human sentence>" }`. One shared helper, uniform
  everywhere.
- **Factory injection everywhere**: `createApp(deps)`, `createDb(...)`, route factories that close
  over their dependencies. No module-scope singletons in the route layer — it keeps handlers
  testable via `app.request()` with no HTTP server and lets tests inject throwaway databases.
- **OpenAPIHono** (`@hono/zod-openapi`): routes are declared with typed request/response schemas, which
  gives us validation and a free OpenAPI doc at `/doc` (+ Scalar UI at `/docs`).

Where we deliberately diverge from pleasehold.dev:

- **Same runtime as pleasehold — plain Node on our k8s infra** (Docker images → GHCR → GitOps
  against the infra repo). No Cloudflare Workers target; we don't optimize for edge runtimes.
  Self-hosters get the same images via docker compose. Redis backs rate limiting
  (hono-rate-limiter) and queues (BullMQ in `apps/worker`), as in pleasehold.
- **SQLite is the shipped database adapter.** The data layer uses synchronous better-sqlite3
  (`.get()`/`.run()`/`.all()`), which keeps the service code and guarded-statement behavior simple.
  There is currently no libSQL/Turso or Postgres runtime adapter: both require an async data-access
  refactor, and Postgres additionally needs dialect-specific schema/migrations and locking. The
  Postgres work is a deliberate follow-up, not a configuration-only switch.

  The async refactor is the visible cost; the quieter one is that **our atomic statements are not
  all portable**. `scripts/postgres/atomicity.sh` proves it against a real Postgres: the seat cap
  (`INSERT … SELECT … WHERE (SELECT COUNT(*)…) < limit`) is safe on SQLite only because SQLite
  serialises writers. On Postgres every concurrent contender evaluates that subquery against its
  own snapshot, so a limit of 3 sold 12 seats. It needs `SELECT … FROM licenses WHERE id = ? FOR
  UPDATE` first, which queues contenders per licence. The floating-lease renewal has the same
  shape and needs the same lock. The usage quota is a single guarded `UPDATE` on one row, so
  Postgres takes the row lock itself and that one ports unchanged. The hosted product cap is the
  newest member of this family and has the same shape and the same fix (lock the `accounts` row
  first). Any Postgres work starts by running that script.

  Note what the vitest suite can and cannot show here. better-sqlite3 is synchronous, so a
  "concurrent" test through `app.request()` cannot actually interleave inside a guarded statement:
  a read-then-write implementation passes those tests too, which was verified by mutation for the
  product cap. Treat the SQLite race tests as pinning the refusal behaviour, and
  `scripts/postgres/atomicity.mjs` — which carries a negative control proving the unlocked form
  over-allocates — as the thing that actually tests atomicity.

  **The sharpest trap is not SQL at all.** Every guarded statement decides whether it applied by
  reading `result.changes`, which is a better-sqlite3 field. libSQL calls it `rowsAffected` and
  Postgres reports differently again. Read the wrong one and you get `undefined`, and
  `undefined === 0` is `false` — so `if (result.changes === 0) throw activationLimitReached(...)`
  simply stops throwing and **the seat cap silently stops being enforced**. Nothing fails loudly;
  licences just quietly become unlimited. Eleven call sites depend on this field across
  `licensing.ts`, `payments.ts`, `sweep.ts` and `prune.ts`. Any driver change has to sweep all of
  them and then prove the caps still hold with the race tests, not with a green unit suite.

  The second trap is transactions. Our `db.transaction(cb)` callbacks call helpers that take
  `deps` and reach for `deps.db` — the outer client — rather than the transaction handle. On
  better-sqlite3 that is harmless, because it is synchronous and everything shares one
  connection. Every async driver runs an interactive transaction on its own connection, so
  those writes land *outside* the transaction and the atomicity we think we have is not there.
  Issuance (`payments.ts` → `createPurchase`/`issueLicense`) is the case that matters: the
  helpers have to take the `tx` handle before this moves to libSQL or Postgres.
- **Zod v4 everywhere** (pleasehold is stuck on a v3/v4 dual-version override; greenfield means we
  skip that).
- **No Better Auth at all.** pleasehold uses it; we do not. The license key itself is the public
  credential and the admin API uses a bearer token with constant-time compare, so there is no
  user/session system on those surfaces. The console's own sessions come from the bespoke magic-code
  flow above, not from `packages/auth`, which is wired to nothing.

## Domain design (from keygate, adapted)

Keygate's decomposition maps cleanly onto `apps/api/src`: thin route handlers → services (business
logic) → store (data access), with pure domain modules for key generation and token signing that
have zero I/O dependencies and exhaustive unit tests.

Ideas we adopt:

- **One canonical license-lookup helper for public endpoints.** Keygate collapses every public
  failure into a uniform response so endpoints can't become enumeration oracles by disagreeing with
  each other. Our PRD contract distinguishes `404 unknown_key` from `403 license_disabled` (and must —
  disabled is the client's revocation signal), but the discipline stands: one shared
  normalize-and-load path, uniform error shapes, format check before any storage hit.
- **Ed25519 offline tokens, never HMAC.** A symmetric secret shipped inside a desktop binary is
  extractable and forgeable; an embedded public key is not. Tokens carry an `instance_id` binding and
  a TTL. Unlike keygate's hardcoded 7 days, our TTL is configurable — it's a revocation-latency SLA.
- **Atomic limit enforcement in the DB.** Activation limits, floating-lease checkout, and usage
  quotas are single guarded statements (`UPDATE … WHERE current + :delta <= limit RETURNING …`),
  never read-then-write. Each of these paths gets a dedicated race test, as keygate has.
- **Fail-fast boot**: parse signing keys and validate required config at startup, refuse to start on
  insecure defaults; degrade gracefully on optional config (no email key = email disabled).

Keygate pitfalls we avoid:

- Its triple key storage (plaintext + hash + encrypted) is a live migration artifact. Greenfield: we
  store the normalized key with a UNIQUE constraint per PRD §17, no plaintext duplicates.
- Its single global license-signing key can't rotate per product. We support per-product signing keys
  with rotation (multiple active public keys) from the schema up.
- Its in-process rate limiting doesn't survive horizontal scaling. Ours is Redis-backed for
  the cloud and behind a seam for self-host.
- Unbounded append-only logs. `audit_log` and `provider_events` get a documented retention story.

## The frozen contract

`docs/PRD.md` §9 is the public client API and it does not drift. Any change to
activate/validate/deactivate/heartbeat/usage request or response shapes needs a very good reason and
a migration story for every shipped client. The two invariants that matter most:

1. **Unknown key is `404`, never `disabled`.** Only an explicit `disabled` revokes access.
2. **A network failure or inconclusive answer never locks a user out.**

## Retention

`audit_log` and `provider_events` both grow forever by design — they are the payment and
state-change trail, and §16 wants every change to stay explainable. They are also the two
tables that grow with traffic rather than with customers, so they need a policy rather
than a cron nobody wrote:

- **provider_events** is pruned at 30 days, far outside any provider's retry window
  (Stripe gives up after ~3 days), so a redelivery that old will not arrive and dropping
  the row cannot weaken idempotency. Only finished rows go: a row still `processing` is
  either in flight or a stuck claim worth investigating, and deleting it would let the
  same event run twice. The prune runs with the other sweeps and audits what it removed.
- **audit_log** is the operator's record and is not pruned automatically. If it ever needs
  to be, export before deleting — "who disabled this key" outliving the row is the point.

## Tenancy

An `accounts` row is the tenant. It owns products and admin users; the hosted plan and its
limits hang off it. Decisions worth knowing before changing any of it:

- **Account 1 always exists.** Migration 0010 inserts it unconditionally and grandfathers
  it to `pro`. That is what lets an existing install upgrade without waking up capped, what
  gives a self-hoster a working instance with no signup ceremony, and what kept the whole
  pre-tenancy test suite passing unchanged.
- **No foreign keys on the new `account_id` columns.** SQLite refuses a non-NULL default on
  a column added with a `REFERENCES` clause while `foreign_keys` is ON, and the pragma
  cannot be turned off inside the migrator's transaction. The usual Drizzle workaround
  (rebuild the table) is unsafe here because six tables reference `products`.
  `assertAccountsResolve` runs at boot in the constraint's place. A Postgres port would fix
  this properly.
- **`slug` and `key_prefix` stay globally unique.** Both appear in public URLs
  (`/v1/pubkey?product=`, `/v1/stripe/webhook/:product`) and the prefix is how the public
  path resolves a key with no account in hand. Making them per-account later would break
  those URLs, so it is decided. The cost is that one account can learn a slug is taken.
- **The public `/v1` surface is never account-scoped.** `resolveLicense` resolves by prefix
  across all products and must keep doing so: an account join adds a way for a valid key to
  stop working and buys nothing against someone who already holds the key.
- **Cross-account is 404, never 403.** A 403 confirms the slug or id exists in somebody
  else's account. `requireProduct` in `routes/admin/util.ts` is the one place that decides
  this.
- **`ADMIN_TOKEN` is optional and cloud does not set it.** It is instance-wide with no user
  record behind it, which cannot coexist with multi-tenancy; the hosted deployment simply
  has no such credential. On self-host it resolves to the single account, or names one with
  `X-Coolbeans-Account`.
- **A route-inventory test** (`routes/admin/tenancy.test.ts`) fails when a new `/admin`
  route appears without a tenancy assertion. It has already caught one (the billing routes).

## Platform billing

`BILLING_*` is a deliberately separate namespace from `STRIPE_*`: the latter is a
*customer's* integration for selling their own software, the former is customers paying us.
They must be different Stripe accounts, and config refuses to start in production if the
keys match.

Four independent layers keep the two apart, and `billing-isolation.test.ts` exercises all
of them: a distinct URL, a distinct signing secret (a product payload cannot pass
verification at all), a distinct gateway built from a distinct key, and a strict price
filter. Plus a reverse guard, so a product can never be configured onto the Pro price and
have `getProductByStripePrice` mistake a subscription payment for a sale.

Billing being configured is also the single cloud-mode flag. One flag rather than two means
an instance can never enforce a limit that nobody has a way to pay to lift.

Limits are hard where an admin is at a keyboard (creating a product, issuing a key by hand)
and **soft where money has moved**. Webhook-driven issuance never refuses: a Free customer's
buyer has just paid *them*, so withholding that key would break their business to collect an
upgrade fee from us. We issue, log an error, audit it, and stamp `over_limit_since`.
`test/limits-never-lock-out.test.ts` is the guard on all of this.
