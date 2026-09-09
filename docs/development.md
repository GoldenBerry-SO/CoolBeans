# Development

Every command a contributor runs, what each one proves, and which ones need Docker.
[CONTRIBUTING.md](../CONTRIBUTING.md) covers the expectations on a change;
this covers the mechanics.

## Prerequisites

Node >= 22 and pnpm 11 (`corepack enable`). Docker for anything that needs a real PostgreSQL: the
compose stack, the race suite, the commercial journeys, the atomicity checks, and the smoke test.
The default test suite needs none of it.

## The four commands

```sh
pnpm install     # workspace install; also installs the husky pre-commit hook
pnpm build       # turbo build, every package that has one, into dist/
pnpm check       # biome lint + tsc typecheck, the pre-commit gate
pnpm test        # vitest across every package
```

`pnpm test` and `pnpm typecheck` both depend on `^build` in `turbo.json`, so a cold clone builds
its dependencies first without being asked.

Individual scripts exist per package and take a filter:

```sh
pnpm --filter @coolbeans/api test
pnpm --filter @coolbeans/sdk build
```

### The API suite and worker contention

The API tests give each file its own PGlite instance, which is real PostgreSQL compiled to WASM.
A cold instance plus migrations costs about a second, and the suite raises vitest's timeout to 20
seconds to absorb that. On a machine with many cores, vitest starts enough workers that the boot
contention still passes the ceiling, and a handful of files fail with `Test timed out in 20000ms`.
The same files pass on their own.

Capping the workers makes the whole suite deterministic:

```sh
pnpm --filter @coolbeans/api exec vitest run --maxWorkers=4
```

A timeout is therefore not a result on its own. Re-run the file before believing it.

## Running it locally

Configuration comes from the process environment. Nothing loads a `.env` file for you: `.env` is
read by `docker compose`, not by `pnpm dev`. Export the variables, or use compose.

`DATABASE_URL` must be a `postgres://` URL. The server refuses anything else at boot rather than
failing later inside the driver.

```sh
docker run -d --rm --name coolbeans-dev-pg \
  -e POSTGRES_PASSWORD=beans -e POSTGRES_DB=coolbeans \
  -p 55432:5432 postgres:16-alpine

export DATABASE_URL=postgres://postgres:beans@localhost:55432/coolbeans
export ADMIN_TOKEN=...            # 16 characters or more
export SIGNING_KEY_SECRET=...     # 16 characters or more
export EMAIL_PROVIDER=console     # logs rendered emails instead of delivering them
export LOG_MAGIC_CODES=true       # optional: console sign-in codes go to the log
```

Generate the secrets with `openssl rand -hex 32`, and keep them out of the repo.

Boot does not migrate. Apply the schema first, then start the server:

```sh
pnpm --filter @coolbeans/db db:migrate
pnpm --filter @coolbeans/api dev      # http://localhost:3000
```

`GET /health` answers `{"ok":true,"status":"ok"}` once it is up. `MIGRATE_ON_BOOT=true` folds the
migration into boot for a single-process install, which is the only situation where that is safe.

The admin console is a separate Vite dev server on port 5173, proxying `/admin`, `/auth` and `/v1`
to `http://localhost:3000` (override with `API_URL`):

```sh
pnpm --filter @coolbeans/web dev
```

`pnpm dev` at the root runs every app together through Turborepo, which works once the environment
above is exported.

Both `EMAIL_PROVIDER=console` and `LOG_MAGIC_CODES=true` are refused when `NODE_ENV=production`,
which is what the built image sets, so neither can escape local development by way of a copied
`.env`.

## The suites beyond `pnpm test`

### Race suite

```sh
pnpm --filter @coolbeans/api test:race
```

Real PostgreSQL, real connection pools, contention through the real HTTP surface, one file at a
time. PGlite is a single connection and cannot interleave, so a capped path covered only by the
default suite is not covered at all. Anything touching seats, leases, quotas, product caps, event
claims or the outbox belongs here. Its globalSetup provisions the database, so Docker has to be
running. **Untested here.**

### Commercial journeys

```sh
./scripts/journey/journey.sh
```

Stands up a PostgreSQL container, a Stripe stand-in and the API with emails logged rather than
sent, then walks four journeys with hard assertions: a perpetual purchase across three machines, a
refund, a subscription renew and cancel, and self-service key recovery. Signatures are real HMAC,
not a bypass, so the server's own `constructEvent` verifies them. **Untested here.**

### Postgres atomicity checks

```sh
./scripts/postgres/atomicity.sh
```

Runs the guarded-statement checks against a throwaway `postgres:16-alpine` container, because
contention is the whole point. **Untested here.**

### Compose smoke test

```sh
bash scripts/smoke-test.sh
```

Builds the image, brings the stack up, waits for `/health`, issues a first key, and tears
everything down. This is the job CI runs to keep the self-host promise honest. **Untested here.**

### Provider webhook checks

```sh
./scripts/provider-webhook-check.sh
```

Drives the real Stripe CLI against a local server and asserts a key was actually issued, rather
than that the webhook merely returned 200. It needs the Stripe CLI and a Stripe account, so it is a
pre-release check rather than part of the loop. PayPal has no local trigger; the script names the
sandbox payload shape instead. **Untested here, and it talks to a payment provider.**

## Hooks and CI

`pnpm install` installs the husky pre-commit hook, which runs `pnpm run check`. Never bypass it
with `--no-verify`: fix what it reports.

CI runs on every push to `main` and on every pull request:

- **check**: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`, `pnpm test`.
- **smoke**: `scripts/smoke-test.sh`, the compose stack end to end.

Two deploy workflows watch `main`: one builds the image for the API, worker and migration Job, and
one publishes the marketing site to Cloudflare Pages. Both are path-filtered, so a docs-only change
does not roll the service.

## Releasing the packages

`@coolbeans/sdk` and `@coolbeans/cli` version in lockstep, because one tag cannot match two
versions. To cut a release: bump both `package.json` versions to the same number, merge that, then
push a matching `v*` tag. The release workflow verifies the tag against both versions before it
does anything expensive, runs lint, typecheck and the two packages' tests, packs each one for
inspection, and publishes with npm provenance. A version already on the registry is skipped, so a
half-finished release can be repaired by re-running rather than by re-tagging.

`workflow_dispatch` runs it in pack-only mode, which is the way to see what would ship without
publishing.

## Adding a migration

The schema lives in `packages/db/src/schema`. Generate SQL with
`pnpm --filter @coolbeans/db db:generate`, review it, and commit it alongside the schema change.
Migrations are applied by `migrate-cli` under an advisory lock and never by a serving process: the
compose stack has a one-shot `migrate` service, and the cloud has a Kubernetes Job. A server that
starts against an older schema refuses to serve rather than running the DDL itself.

## Where to look next

- [ARCHITECTURE.md](ARCHITECTURE.md) for why the code is shaped this way, and for the Postgres
  traps that fail silently if reintroduced.
- [PRD.md](PRD.md) §9 for the contract that must not drift.
- [CLAUDE.md](../CLAUDE.md) for the ground rules and the concurrency review practice.
