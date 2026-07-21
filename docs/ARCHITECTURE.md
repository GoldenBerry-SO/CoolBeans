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
- **PostgreSQL is the database, everywhere.** One dialect for cloud and self-host: the schema is
  `drizzle-orm/pg-core`, production runs postgres-js against the shared cluster, self-host gets a
  `postgres:16-alpine` service in compose, and the test suite runs PGlite — real Postgres compiled
  to WASM — through the same `Database` type with no casts. SQLite was the original adapter; the
  port was a rewrite of the atomic-enforcement paths, not a configuration switch, and the traps it
  had to clear are recorded here because every one of them fails *silently* if reintroduced.

  **Atomicity needs locks, not just guarded statements.** Under MVCC every concurrent contender
  evaluates a `WHERE (SELECT COUNT(*)…) < limit` guard against its own snapshot: the race suite
  measured a 3-seat cap admitting all 12 contenders and a 1-product plan accepting 8. The seat
  cap and lease revival serialise on the licence row (`SELECT … FOR UPDATE`), the product cap on
  the accounts row. Two paths deliberately take no lock: extending a still-live lease cannot
  change the live count, so the heartbeat hot path stays lock-free; and unlimited plans skip the
  product-cap transaction, so a self-hoster never takes an account lock. The usage quota is a
  single-row guarded `UPDATE` and needs no lock — Postgres re-evaluates its WHERE under the row
  lock it takes itself. `pnpm test:race` is the oracle: real server, real pools, contention
  through the real HTTP surface, and each locking test was seen red against the unlocked form.
  PGlite is one connection and cannot interleave, so **a capped path covered only by the default
  suite is not covered**.

  **Never read a driver rowcount.** `result.changes` was better-sqlite3's spelling; postgres-js
  has no such field, and `undefined === 0` is `false`, so a missed conversion makes a cap
  silently stop being enforced with nothing in any log. Every guarded statement now carries
  `RETURNING` and decides via `applied()`/`affected()` from `@coolbeans/db`, which read rows in
  both drivers' result shapes (postgres-js returns arrays, PGlite `{rows}`) and throw on anything
  else; `rowsOf()` is the read-side twin. The `no-driver-rowcounts` source-scan test bans every
  count-field spelling outright — load-bearing, because the shared `Database` type widens the
  driver result and the compiler cannot catch this class.

  **Transactions bind through `withTx`.** Helpers take a deps bundle and reach `deps.db`, so the
  only way to run one inside a transaction is `withTx(deps, tx)`, which rebinds the bundle. A
  helper handed the outer deps writes on another pool connection outside the transaction — a
  rolled-back issuance then leaves a purchase whose `provider_checkout_id` UNIQUE blocks every
  provider retry forever. On the single-connection test driver the same mistake deadlocks, so the
  suite catches it structurally.

  **Constraint violations abort the whole transaction** (SQLite left it usable). The issuance
  key-collision retry runs each attempt in a savepoint, or attempt two dies with 25P02 and a paid
  customer gets no key; the usage-counter create is an upsert whose no-op DO UPDATE hands the
  loser the winner's row; the product-slug conflict catch sits outside the transaction callback.

  **Exactly-once machinery:** the webhook claim fence is a random token minted by the claim
  statement itself (`RETURNING claim_token`) — never re-read after the fact, which is the gap
  that hands an elder claimant its successor's fence — and the outbox drain claims with
  `FOR UPDATE SKIP LOCKED` so two workers never both send the same email.

  **Dates are ISO-8601 strings compared lexicographically**, so every database-side default goes
  through the shared `isoNow` fragment in `packages/db/src/schema/columns.ts`. `now()::text`
  yields a space instead of `T` — and `' ' < 'T'` sorts every defaulted row before every
  app-written one, which alone would make the event-retention prune delete finished events
  immediately.

  **Migrations run in exactly one place.** Boot does not migrate — N replicas plus a worker plus
  a deploy Job would race DDL — it runs `assertSchemaCurrent` and refuses to serve a schema the
  build was not made for. `migrate-cli` (advisory-locked) is the single migrator: the k8s Sync
  hook in cloud, the one-shot `migrate` service in compose, `MIGRATE_ON_BOOT=true` for a genuine
  single-process self-host. The foreign keys SQLite could not take are real now (RESTRICT on
  customer data), and `assertAccountsResolve` stays for one release as the proof they took.
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

**The Goldenberry Stripe account is shared across products**, and Stripe fans every
subscribed event out to every webhook endpoint on the account. The org-wide convention that
makes this manageable: every app stamps `gb_app: <its slug>` on the customers, checkout
sessions and subscriptions it creates (`APP_METADATA_KEY` in `billing-gateway.ts`), and
every webhook bounces events stamped for a sibling app with a 200 *before* claiming them —
otherwise each busy sibling writes a `provider_events` row and a warn log here forever.
Absence of the stamp must never bounce (dashboard-created objects carry none), and the
strict price-id filter stays the authority on money: the stamp is routing, not security.
A future Goldenberry app on this account copies exactly this shape with its own slug.

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
