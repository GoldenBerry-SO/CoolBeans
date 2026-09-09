---
layout: ../../layouts/DocsLayout.astro
title: Self-hosting
description: Run your own Cool Beans with docker compose, plus a reference for every configuration variable.
---

Cool Beans is MIT licensed and self-host is unlimited. Same codebase as the hosted cloud, no
feature flags held back.

## docker compose

The stack is the API, a background worker, PostgreSQL 16 and Redis. A one-shot `migrate` service
applies migrations before anything serves, which is the same entrypoint the cloud migration Job
runs, so self-host and cloud share one code path.

```sh
cp .env.example .env
# fill in POSTGRES_PASSWORD, ADMIN_TOKEN, SIGNING_KEY_SECRET, EMAIL_PROVIDER
docker compose up
```

Compose needs these in the environment or `.env`, and refuses to start without them:

- `POSTGRES_PASSWORD`: the database password. Compose builds `DATABASE_URL` from it.
- `ADMIN_TOKEN`: bearer token for admin endpoints and the CLI.
- `SIGNING_KEY_SECRET`: encrypts offline-token signing private keys at rest.
- `EMAIL_PROVIDER`: `resend` or `smtp`, **plus its credential**: `RESEND_API_KEY` for resend, or at
  least `SMTP_HOST` (and usually `SMTP_USER` / `SMTP_PASS`) for smtp. Compose only enforces
  `EMAIL_PROVIDER` itself; with the credential missing the API still starts, it just can't deliver
  key emails. `console`, which logs emails instead of sending them, is for running from source: the
  image sets `NODE_ENV=production` and the server refuses to start with it, because an instance
  that quietly logs key emails looks healthy while every buyer waits.

Optional: `PUBLIC_URL` (defaults to `http://localhost:3000`) and `API_PORT` (defaults to `3000`,
which is the host port mapped to the container's 3000).

Generate the two secrets:

```sh
openssl rand -hex 32
```

Once it's up, `GET /health` answers `{ "ok": true, "status": "ok" }` and `GET /docs` serves
interactive API docs.

`MIGRATE_ON_BOOT=true` exists for a genuinely single-process install where you don't want a
separate migrate step.

## Running from source

Prereqs: Node >= 22, pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm build
pnpm test       # vitest, against PGlite: no database to install
pnpm check      # biome lint + typecheck
```

Starting the server takes a little more than `pnpm dev`, because nothing in the repo reads a `.env`
file: that is compose's job. Export `DATABASE_URL` (a `postgres://` URL, which the server insists
on), `ADMIN_TOKEN` and `SIGNING_KEY_SECRET`, apply the schema with
`pnpm --filter @coolbeans/db db:migrate`, then run `pnpm --filter @coolbeans/api dev`. The full
recipe, including the throwaway database and the console dev server, is in
[docs/development.md](https://github.com/GoldenBerry-SO/CoolBeans/blob/main/docs/development.md).

## Configuration reference

Copy `.env.example` to `.env` and fill it in. In k8s these come from the deployment env and secrets
instead.

### Core (required)

| Variable | What it does |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL. Compose provides the server; this is the in-network address. |
| `ADMIN_TOKEN` | Bearer token for admin endpoints and the `beans` CLI. Generate with `openssl rand -hex 32`. Required for self-host. The hosted deployment leaves this unset on purpose: it's a global bypass with no account behind it, which has no place in a multi-tenant instance. |
| `SIGNING_KEY_SECRET` | Encrypts offline-token signing private keys at rest. Generate with `openssl rand -hex 32`. |

### Server

| Variable | What it does |
|---|---|
| `PORT` | Listen port when running the Node process directly. Default `3000`. Under compose the container always listens on 3000 and the host-side knob is `API_PORT` instead. |
| `PUBLIC_URL` | Where the console and portal are served from, used to build portal, billing and Connect callback links. Defaults to `http://localhost:<PORT>`. |
| `REDIS_URL` | Backs rate limiting across replicas and the background job queue. Compose sets it. Without it, rate limiting falls back to in-process counters, which is right for a single instance and wrong for several. |
| `MIGRATE_ON_BOOT` | `true` folds migrations into server startup, for a genuinely single-process install. Anything with replicas or a separate worker leaves this unset and runs the migrator on its own. |
| `WEB_ROOT` | Where the built admin console is served from. Defaults to `apps/web/dist`, which is where the image puts it. |
| `NODE_ENV` | `production` in the shipped image. It is what makes the server refuse the development-only settings below. |

### Offline tokens

| Variable | What it does |
|---|---|
| `OFFLINE_TOKEN_TTL_DAYS` | Lifetime of the signed offline token a normal `validate` returns, in days. Default `7`. |
| `OFFLINE_TOKEN_BUFFER_DAYS` | Days added to a licence's expiry when it goes into a signed offline token. The SDK ends access when a signed `expires_at` has passed, so the raw expiry would lock out a subscriber who renewed while offline and still holds a stale token. This is the room they get to reconnect. Never applied to trials. Default `14`. |
| `OFFLINE_ACTIVATION_TTL_DAYS` | TTL for a vendor-issued offline activation, in days. Long because an air-gapped machine can never refresh: it gets one token and lives on it. Always clamped to the licence's own expiry. Note that such a machine cannot be revoked before this elapses. Default `365`. |

### The three Stripe namespaces

This is the part people get wrong, so it's worth stating plainly. There are **three separate
`*STRIPE*` namespaces** and they are three different Stripe accounts doing three different jobs.
Never reuse one for another.

#### `STRIPE_*`: you selling your software

The vendor's own Stripe account. This is the one a self-hoster sets.

| Variable | What it does |
|---|---|
| `STRIPE_SECRET_KEY` | Restricted key: Checkout Sessions read, Subscriptions read. |
| `STRIPE_WEBHOOK_SECRET` | Verifies incoming Stripe webhooks. |
| `STRIPE_API_BASE` | Local journey tests only: point the Stripe SDK at a mock instead of `api.stripe.com`. Leave unset everywhere else. |

#### `BILLING_STRIPE_*`: us charging customers for hosted Cool Beans

Platform billing, hosted Cool Beans only. Leave blank for self-host.

This is Goldenberry charging customers for hosted Cool Beans, **not** a customer selling their own
software. That's `STRIPE_SECRET_KEY` above, and the two must be different Stripe accounts. Sharing
one puts both flows on a single event stream where a Pro purchase can be mistaken for a product
sale. The server refuses to start if they match in production.

**Setting `BILLING_STRIPE_SECRET_KEY` is what puts the instance in cloud mode**: plan limits apply
(Free is 1 product and 500 active licences) and public signup opens. Leave it blank and everything
is unlimited, which is what self-host is.

| Variable | What it does |
|---|---|
| `BILLING_STRIPE_SECRET_KEY` | Turns on cloud mode. Blank for self-host. |
| `BILLING_STRIPE_PRO_PRICE_ID` | Required whenever the key above is set, or every upgrade attempt fails. |
| `BILLING_STRIPE_WEBHOOK_SECRET` | Required in production: without it Stripe charges the card and we never record it. |
| `BILLING_STRIPE_API_BASE` | Local journey tests only, same as `STRIPE_API_BASE`. |

#### `CONNECT_STRIPE_*`: Stripe Connect for cloud multi-vendor

Cloud multi-vendor only. Leave blank for self-host.

The platform Connect credential. On the hosted deployment each vendor authorizes their own Stripe
account through Connect, and all their events arrive on ONE platform endpoint
(`/v1/connect/stripe/webhook`) keyed by the signed `event.account`. Separate account and namespace
from `STRIPE_*` (self-host, one account) and `BILLING_STRIPE_*` (us charging customers), so the
three can never be confused. Self-host leaves all of these blank and uses `STRIPE_*` with its
single default connection instead.

| Variable | What it does |
|---|---|
| `CONNECT_STRIPE_SECRET_KEY` | The platform Connect credential. |
| `CONNECT_STRIPE_CLIENT_ID` | The Connect OAuth client id (`ca_...`). Required for vendor self-serve onboarding: the console sends them to Stripe with this, and Stripe returns them to `PUBLIC_URL/v1/connect/stripe/callback`, which must be listed as a redirect URI on the Connect application. |
| `CONNECT_STRIPE_WEBHOOK_SECRET` | Required in production whenever `CONNECT_STRIPE_SECRET_KEY` is set: without it connected events arrive and none can be verified, so no cloud vendor is ever paid. |
| `CONNECT_STRIPE_API_BASE` | Local journey tests only, same as `STRIPE_API_BASE`. |

### PayPal (optional)

| Variable | What it does |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal app client id. |
| `PAYPAL_SECRET` | PayPal app secret. |
| `PAYPAL_WEBHOOK_ID` | Used to verify PayPal webhook signatures. |

### Email (required in production, pick one)

| Variable | What it does |
|---|---|
| `EMAIL_PROVIDER` | `resend`, `smtp`, or `console`. `console` logs emails instead of delivering them, so running from source needs no mail provider at all. It's refused when `NODE_ENV=production`, which the shipped image sets. |
| `RESEND_API_KEY` | For `EMAIL_PROVIDER=resend`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | For `EMAIL_PROVIDER=smtp`. `SMTP_PORT` defaults to `587`. |
| `EMAIL_SENDER` | The verified From address for platform-sent mail. Set it where key and recovery emails must come from a domain you have verified rather than a customer's; the product's own address then becomes Reply-To. Leave it unset on self-host and the per-product `email_from` is used directly. |

The server refuses to start in production with no email provider at all. An instance that issues
keys and never delivers them answers `200` to Stripe and looks healthy while every buyer waits.

### Local development only

| Variable | What it does |
|---|---|
| `LOG_MAGIC_CODES` | Print console sign-in codes to the log instead of hunting for the email. A code is a credential, so the server refuses to start with this enabled when `NODE_ENV=production`. |
| `EMAIL_PROVIDER=console` | Log each rendered email instead of delivering it. Refused under `NODE_ENV=production` for the same reason. |
| `RESEND_BASE_URL` | Point the Resend client at a mock instead of `api.resend.com`, for the journey scripts. Nothing enforces this one, so leave it unset anywhere real. |

## Rate limiting

The hosted deployment enforces 30 req/min/IP on `/v1/*` through Redis-backed middleware. The
webhook path is excluded, because it's protected by signature verification instead.
