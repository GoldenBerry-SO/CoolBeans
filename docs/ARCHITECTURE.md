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
  10-minute TTL, 5-attempt cap, first sign-in bootstraps the account. It is simpler than a full auth
  library for a passwordless admin surface and matches the approved design. `packages/auth` stays in
  the tree for the day we need SSO or organizations.
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
  Postgres takes the row lock itself and that one ports unchanged. Any Postgres work starts by
  running that script.

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
- **Better Auth only for the dashboard.** The license key itself is the public credential and the
  admin API uses a bearer token with constant-time compare — no user/session system on those
  surfaces. Better Auth (`packages/auth`, pleasehold's pattern) backs admin sessions for the web
  dashboard only.

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
