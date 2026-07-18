# Cool Beans

> The open-source license layer. Issue a key, activate it, check it's still good.
> "Your licence? Cool beans — you're all set."

Cool Beans is a small MIT-licensed service that issues and validates software license keys and turns
Stripe/PayPal payment events into license state. A customer buys, gets a key, activates it on their
machines, and Cool Beans is the source of truth for whether that key is still good.

One codebase, two homes:

- **Self-host** on Node with SQLite (or Postgres) — free forever, `docker compose up`.
- **Cloud** on our k8s infrastructure (Docker + Postgres + Redis) — the hosted convenience option.

It's a drop-in for the Lemon Squeezy License API, so existing clients migrate with a base-URL change.

**Status: v1 built.** Full license lifecycle, Stripe + PayPal payments, offline-token SDK, usage
metering, LS-parity routes, admin console, customer portal, worker, and Docker/k8s packaging are
implemented and tested (225 automated tests plus a Docker Compose smoke test). Full product spec:
[`docs/PRD.md`](docs/PRD.md). Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Design
system: [`docs/DESIGN.md`](docs/DESIGN.md). PRD coverage: [`docs/VALIDATION.md`](docs/VALIDATION.md).

## Repo layout

```
apps/
  api/          Hono API server (Node)
  worker/       BullMQ background-job processor
  web/          React SPA (Vite) — the admin dashboard
packages/
  auth/         Better Auth factory — admin sessions for the dashboard only
  cli/          beans — the admin CLI
  db/           Drizzle schema + storage adapter (SQLite dev/self-host, Postgres in production)
  email/        React Email templates + Resend/SMTP sender seam
  logger/       Structured logger — zero deps
  sdk/          @coolbeans/sdk — drop-in client for Node, Electron, Tauri, and the browser
docs/           PRD and architecture notes
```

## Development

Prereqs: Node >= 22, pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm dev        # local dev server on :3000
pnpm test       # vitest
pnpm check      # biome lint + typecheck
```

`GET /health` answers `{ "ok": true }`. `GET /docs` serves interactive API docs.

## License

MIT. See [LICENSE](LICENSE).
