# Cool Beans — Architecture notes

How this repo is put together and why. The product spec is [`PRD.md`](PRD.md); this doc records the
engineering decisions, most of them borrowed from two references:

- **pleasehold.dev** (sibling repo): repo structure, tooling, and Hono conventions.
- **keygate** (`temporal/keygate`, gitignored clone of https://github.com/tabloy/keygate): domain
  design for a license service. It's AGPL — we copy ideas, never code.

## Repo shape (from pleasehold.dev)

pnpm workspaces + Turborepo. `apps/api` is the Hono service; `apps/web` is the React SPA for the
admin dashboard (Vite + TanStack Router, mirroring pleasehold's `apps/web`; in production the API
serves its built assets); `packages/db` holds the Drizzle schema and storage adapter;
`packages/auth` wraps Better Auth for dashboard admin sessions; `packages/logger` is our own small
structured logger (zero deps, Node + Workers); `packages/cli` is the `beans` admin CLI;
`packages/sdk` is the publishable client. Conventions carried over wholesale:

- **Biome** (tabs, single quotes, lineWidth 100), per-package `lint`/`format`/`typecheck`/`test`
  scripts, husky pre-commit running `pnpm run check`.
- **ABOUTME headers**: every source file opens with two `// ABOUTME:` comment lines.
- **Response envelope**: success bodies carry `ok: true` (the PRD §9 contract shape); errors are
  `{ "ok": false, "error": "<code>", "message": "<human sentence>" }`. One shared helper, uniform
  everywhere.
- **Factory injection everywhere**: `createApp(deps)`, `createDbSqlite(...)`/`createDbD1(...)`, route
  factories that close over their dependencies. No module-scope singletons in the route layer. This is
  what makes one codebase serve two runtimes and makes handlers testable via `app.request()` with no
  HTTP server.
- **OpenAPIHono** (`@hono/zod-openapi`): routes are declared with typed request/response schemas, which
  gives us validation and a free OpenAPI doc at `/doc` (+ Scalar UI at `/docs`).

Where we deliberately diverge from pleasehold.dev:

- **It's Node + Postgres only; we target Node *and* Workers.** The runtime seam is two entrypoints
  over one `createApp`: `src/node.ts` (`@hono/node-server`) and `src/worker.ts` (`export default`).
- **SQLite dialect first, not Postgres.** Drizzle's sqlite dialect covers both better-sqlite3
  (self-host) and D1 (cloud) with a single schema and a single migrations folder. Postgres support is
  a later adapter, per the PRD.
- **No Redis, no BullMQ.** Neither runs on Workers. Rate limiting is Cloudflare WAF on the cloud and
  a middleware seam for self-host; async work stays in-request or behind Cron Triggers.
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
- Its in-process rate limiting doesn't survive horizontal scaling. Ours lives at the edge (WAF) for
  the cloud and behind a seam for self-host.
- Unbounded append-only logs. `audit_log` and `provider_events` get a documented retention story.

## The frozen contract

`docs/PRD.md` §9 is the public client API and it does not drift. Any change to
activate/validate/deactivate/heartbeat/usage request or response shapes needs a very good reason and
a migration story for every shipped client. The two invariants that matter most:

1. **Unknown key is `404`, never `disabled`.** Only an explicit `disabled` revokes access.
2. **A network failure or inconclusive answer never locks a user out.**
