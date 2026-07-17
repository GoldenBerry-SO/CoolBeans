# Cool Beans

> The open-source license layer. Issue a key, activate it, check it's still good.
> "Your licence? Cool beans — you're all set."

Cool Beans is a small MIT-licensed service that issues and validates software license keys and turns
Stripe/PayPal payment events into license state. A customer buys, gets a key, activates it on their
machines, and Cool Beans is the source of truth for whether that key is still good.

One codebase, two homes:

- **Self-host** on Node with SQLite (or Postgres) — free forever, `docker compose up`.
- **Cloud** on Cloudflare Workers + D1 — the hosted convenience option.

It's a drop-in for the Lemon Squeezy License API, so existing clients migrate with a base-URL change.

**Status: early scaffold.** The spec is done, the build is underway — see the issue tracker for
progress. Full product spec: [`docs/PRD.md`](docs/PRD.md). Architecture decisions:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repo layout

```
apps/
  api/          Hono API server — runs on Node (self-host) and Cloudflare Workers (cloud)
packages/
  db/           Drizzle schema + storage adapter (better-sqlite3 / D1 behind one Database type)
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
