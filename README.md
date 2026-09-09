<p align="center">
  <img src="apps/www/public/cool-beans-icon.png" alt="Cool Beans" width="96" height="96">
</p>

<h1 align="center">Cool Beans</h1>

<p align="center">
  The open source license layer. Issue a key, activate it, check it's still good.<br>
  One call in the app: <code>const state = await cb.open(key)</code><br>
  <em>"Your licence? Cool beans, you're all set."</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c8ff4d" alt="MIT license"></a>
  <a href="https://coolbeans.tools"><img src="https://img.shields.io/badge/website-coolbeans.tools-1a1a19" alt="Website"></a>
  <a href="https://coolbeans.tools/docs"><img src="https://img.shields.io/badge/docs-coolbeans.tools%2Fdocs-3f6b12" alt="Docs"></a>
  <a href="https://github.com/GoldenBerry-SO/coolbeans-swift"><img src="https://img.shields.io/badge/SDKs-TypeScript%20%2B%20Swift-8a63d2" alt="SDKs"></a>
</p>

Cool Beans is a small MIT-licensed service that issues and validates software license keys and turns
Stripe/PayPal payment events into license state. A customer buys, gets a key, activates it on their
machines, and Cool Beans is the source of truth for whether that key is still good.

You can run it yourself or let us run it for you. It's the same codebase either way.

- **Self-host** is free forever: Node with PostgreSQL 16, up in one `docker compose up`.
- **Cloud** at [app.coolbeans.tools](https://app.coolbeans.tools) is run by us, with Stripe Connect
  so every vendor plugs in their own Stripe account.

## Status

Pre-1.0. The workspace is versioned `0.0.0` and private; the two publishable packages,
`@coolbeans/sdk` and `@coolbeans/cli`, sit at `0.1.0`.

Neither package is on the npm registry yet. The release workflow that publishes them exists and
fires on a `v*` tag; no such tag has been pushed. Until one is, use the SDK and the CLI from this
repo (see [TypeScript SDK](https://coolbeans.tools/docs/sdk-typescript) and
[the beans CLI](https://coolbeans.tools/docs/cli)). Tracked as
[#123](https://github.com/GoldenBerry-SO/coolbeans/issues/123).

The Swift SDK lives in its own repository,
[GoldenBerry-SO/coolbeans-swift](https://github.com/GoldenBerry-SO/coolbeans-swift), and is
consumed through SwiftPM.

## The whole integration

```ts
import { CoolBeans } from '@coolbeans/sdk';

const cb = new CoolBeans({ product: 'acme', storage });

const state = await cb.open(licenseKey); // on launch, and when a key is pasted
if (state.decision === 'deny') lockApp(state.reason);
```

`open()` activates on first run, validates after that, refreshes when it can, and falls back to a
signed offline token when it can't. Every inconclusive answer keeps the app unlocked. Only an
explicit revocation, or a signed expiry, denies. The same contract ships for
[Swift](https://github.com/GoldenBerry-SO/coolbeans-swift), and a shared fixture set
(`contract/access-states.json`) keeps both SDKs agreeing about who stays unlocked.

## What's in the box

- **Full license lifecycle.** Issue, activate, validate, deactivate, heartbeat. Node-locked or
  floating seats, enforced atomically on the server.
- **Payments to keys.** Stripe and PayPal webhooks issue on checkout, disable on refund, chargeback
  and subscription lapse. A licence grant maps one price to what the buyer gets: duration, seats,
  and a signed capability map the app reads as `state.entitlements`.
- **Offline by contract.** Signed ed25519 tokens keep paying customers unlocked with no network at
  all. An unknown key is a 404, never a lockout.
- **Usage metering.** Atomic quota enforcement per licence, per metric.
- **Outbound webhooks.** HMAC-signed lifecycle events for your CRM, analytics, or Slack.
- **Admin console, customer portal, `beans` CLI**, and Lemon Squeezy License API parity routes
  (same request and response shapes; keys are issued by Cool Beans, there is no key import).
- **Agent-ready.** Every instance serves `/v1/llms.txt` and a per-product integration brief, so a
  coding agent can wire your app up in one read.

## Self-host in one command

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD, ADMIN_TOKEN, SIGNING_KEY_SECRET, EMAIL_PROVIDER
docker compose up
```

The stack is the API, a background worker, PostgreSQL 16 and Redis, with a one-shot `migrate`
service that applies migrations before anything serves. `GET /health` answers
`{ "ok": true, "status": "ok" }`, `GET /docs` serves the interactive API reference, and the
[self-hosting guide](https://coolbeans.tools/docs/self-hosting) covers every variable. Self-host is
unlimited: no caps, no feature flags held back.

## Getting started as a developer

Prerequisites: Node >= 22, pnpm 11 (`corepack enable`), and Docker if you want a local PostgreSQL.

```sh
git clone https://github.com/GoldenBerry-SO/CoolBeans.git
cd CoolBeans
pnpm install
pnpm build       # turbo build, every package that has one
pnpm check       # biome lint + tsc typecheck
pnpm test        # vitest, against PGlite (no database to install)
```

`pnpm install` also installs the husky pre-commit hook, which runs `pnpm run check`.

### Running the API locally

The service reads its configuration from the process environment. Nothing in the repo loads a
`.env` file for you: `.env` is read by `docker compose`, not by `pnpm dev`. Export the variables
yourself, or point compose at them.

`DATABASE_URL` must be a `postgres://` URL; the server refuses to start otherwise. A throwaway
container is enough:

```sh
docker run -d --rm --name coolbeans-dev-pg \
  -e POSTGRES_PASSWORD=beans -e POSTGRES_DB=coolbeans \
  -p 55432:5432 postgres:16-alpine

export DATABASE_URL=postgres://postgres:beans@localhost:55432/coolbeans
export ADMIN_TOKEN=...            # any string of 16 characters or more
export SIGNING_KEY_SECRET=...     # any string of 16 characters or more
export EMAIL_PROVIDER=console     # logs emails instead of delivering them

pnpm --filter @coolbeans/db db:migrate   # boot does not migrate; this is the migrator
pnpm --filter @coolbeans/api dev         # http://localhost:3000
```

Generate the two secrets with `openssl rand -hex 32`. Never commit them.

`curl http://localhost:3000/health` answers `{"ok":true,"status":"ok"}` once it is up.

The admin console is a separate Vite dev server that proxies `/admin`, `/auth` and `/v1` to the API:

```sh
pnpm --filter @coolbeans/web dev         # http://localhost:5173
```

`pnpm dev` at the root starts every app at once through Turborepo, which is convenient when the
environment above is already exported.

For the race suite, the commercial journeys, the compose smoke test and the release flow, see
[docs/development.md](docs/development.md).

## The API surface at a glance

The public client contract is frozen (PRD §9). Every body carries `ok`, the licence key is the only
credential, and no public endpoint takes a service secret.

| Endpoint | What it does |
|---|---|
| `POST /v1/activate` | Binds a key to a device and takes a seat |
| `POST /v1/validate` | Confirms a key and returns a signed offline token |
| `POST /v1/deactivate` | Frees a seat, idempotently |
| `POST /v1/heartbeat` | Renews a floating lease |
| `POST /v1/keyset` | Signing keys for the product a licence belongs to |
| `GET /v1/pubkey?product=<slug>` | The same keys, by product slug |
| `POST /v1/usage/increment`, `GET /v1/usage` | Atomic metering and quota reads |
| `POST /v1/licenses/{activate,validate,deactivate}` | Lemon Squeezy parity shapes |
| `POST /v1/portal/{lookup,recover,billing-session}` | Key-authed customer self-service |
| `GET /v1/purchase/session/:checkout_session_id` | Success-page purchase lookup, product-token authed |
| `GET /v1/llms.txt`, `GET /v1/integration/:slug` | Markdown integration guides for coding agents |
| `POST /v1/stripe/webhook`, `/v1/paypal/webhook` | Provider webhooks, signature-verified before parsing |

Admin lives under `/admin`, authenticated by a magic-code console session, the instance
`ADMIN_TOKEN`, or a per-product token: products, keys, grants, team, audit, export, outbound
webhook endpoints, billing, and unfulfilled-payment rescue. Cross-account access answers `404`,
never `403`.

`GET /doc` serves the OpenAPI document for the frozen public surface and `GET /docs` renders it.
Full reference: [HTTP API](https://coolbeans.tools/docs/http-api).

## SDKs

- **TypeScript**, in this repo at [`packages/sdk`](packages/sdk/README.md): Node, Electron, Tauri
  and the browser, zero runtime dependencies, Ed25519 through WebCrypto.
- **Swift**, at [GoldenBerry-SO/coolbeans-swift](https://github.com/GoldenBerry-SO/coolbeans-swift):
  macOS and iOS, Keychain storage, the same verdict type.

Both run `contract/access-states.json`, so neither can change who stays unlocked without failing a
test. Copyable per-host quickstarts live in [`examples/`](examples/README.md).

## Architecture

Node and TypeScript on [Hono](https://hono.dev), one codebase for self-host and cloud, PostgreSQL
everywhere. Route handlers stay thin and hand off to services (business logic) and store (data
access), with pure domain modules for key generation and token signing that have no I/O.
Dependencies are injected through `createApp(deps)`, so handlers are testable via `app.request()`
with no HTTP server.

```
apps/
  api/          Hono API server (Node)
  worker/       BullMQ background-job processor
  web/          React SPA (Vite), the admin dashboard
  www/          Astro marketing site + docs, coolbeans.tools (Cloudflare Pages)
packages/
  auth/         Better Auth factory, wired to nothing today
  cli/          beans, the admin CLI
  db/           Drizzle pg schema, postgres-js adapter, and the migrate CLI
  email/        React Email templates + Resend/SMTP sender seam
  logger/       Structured logger, zero deps
  sdk/          @coolbeans/sdk, one open() call on launch
contract/       access-states.json, the access states every SDK must agree on
docs/           PRD, architecture, design, validation, and developer notes
examples/       Copyable quickstarts, one per host
scripts/        Smoke test, commercial journeys, Postgres atomicity checks
```

Four rules carry most of the design, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains each:

- **The public contract is frozen.** PRD §9 shapes do not drift; products ship against them.
- **Offline-tolerant by contract.** An unknown key is `404`, never `disabled`. Only an explicit
  `disabled` revokes access, so no failure mode locks out a paying user.
- **Atomic limit enforcement.** Seats, floating leases and usage quotas are single guarded SQL
  statements under a row lock, never read-then-write, with a dedicated race suite as the oracle.
- **Tenancy is enforced in the store layer.** An `accounts` row is the tenant, and cross-account
  reads answer `404` so nothing confirms what lives in someone else's account.

## Development workflow

Work happens on branches off `main`, one pull request per change, with tests written first. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before the first PR: it covers the setup, the expectations, and
the five rules that get extra scrutiny because they protect paying end users.

CI runs lint, typecheck and the test suite on every push and pull request, plus a Docker Compose
smoke test that boots the stack and issues a first key. Changes touching concurrency or
exactly-once behaviour get an OpenAI Codex review before merge; see [CLAUDE.md](CLAUDE.md).

## Documentation

Published docs live at [coolbeans.tools/docs](https://coolbeans.tools/docs) and their source is in
[`apps/www/src/pages/docs/`](apps/www/src/pages/docs).

| Page | What it covers |
|---|---|
| [What Cool Beans is](https://coolbeans.tools/docs) | The mental model and the one rule that matters |
| [Quickstart](https://coolbeans.tools/docs/quickstart) | Issue a key and wire up an app |
| [Self-hosting](https://coolbeans.tools/docs/self-hosting) | Compose, plus every configuration variable |
| [TypeScript SDK](https://coolbeans.tools/docs/sdk-typescript) | The full client surface |
| [Swift SDK](https://coolbeans.tools/docs/sdk-swift) | macOS and iOS |
| [The beans CLI](https://coolbeans.tools/docs/cli) | Every command and flag |
| [HTTP API](https://coolbeans.tools/docs/http-api) | The frozen contract, by hand |
| [Payments](https://coolbeans.tools/docs/payments) | Prices, grants, and what the webhook does |
| [Outbound webhooks](https://coolbeans.tools/docs/webhooks) | Lifecycle events for your systems |
| [Offline verification](https://coolbeans.tools/docs/offline) | Tokens, grace, and air-gapped machines |
| [Migrating from LemonSqueezy](https://coolbeans.tools/docs/migrate-from-lemonsqueezy) | Parity routes and the migration path |

In-repo notes, indexed in [docs/README.md](docs/README.md):

| Document | What it covers |
|---|---|
| [docs/PRD.md](docs/PRD.md) | The full product spec, and §9, the frozen contract |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engineering decisions and the traps behind them |
| [docs/development.md](docs/development.md) | Every command a contributor runs, and what each proves |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Section-by-section check of the build against the PRD |
| [docs/DESIGN.md](docs/DESIGN.md) | The console and portal design system |
| [docs/OUTBOUND-WEBHOOKS.md](docs/OUTBOUND-WEBHOOKS.md) | The webhook emitter, from the inside |

Also here: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [CLAUDE.md](CLAUDE.md), and package READMEs for
[`packages/sdk`](packages/sdk/README.md), [`packages/cli`](packages/cli/README.md) and
[`examples/`](examples/README.md).

## License

MIT. See [LICENSE](LICENSE).
