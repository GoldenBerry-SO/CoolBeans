# Cool Beans

The open-source license layer. Issue a key, activate it, check it's still good.

## The crew

- The AI on this project goes by **BEANZILLA** (imagine a monster truck made of legumes doing a backflip over a row of flaming laptops).
- The human goes by **Chrash Bandicoot** (Chris, but 90s). Address him as Chris in normal conversation, Chrash Bandicoot when the moment calls for ceremony.

## What this is

A small Hono/TypeScript service that issues and validates software license keys and turns
Stripe/PayPal payment events into license state. One codebase runs on Node (self-host, SQLite or
Postgres). Deployed to our k8s infra like pleasehold; self-host via docker compose. MIT licensed. See `docs/PRD.md` for the full spec and
`docs/ARCHITECTURE.md` for the decisions.

## Ground rules for this repo

- **§9 of the PRD is a frozen contract.** The public client API (activate/validate/deactivate/
  heartbeat/usage shapes) must not drift. Products build against it.
- **Offline-tolerant by contract.** An unknown key is `404`, never `disabled`. Only an explicit
  `disabled` signal revokes access. Never make a change that could lock out an offline user.
- **The key is the credential.** Public endpoints carry no service secret. Admin endpoints use bearer
  tokens with constant-time compare.
- **Atomic limit enforcement.** Activation limits, floating leases, and usage quotas are enforced in a
  single guarded DB statement, never read-then-write. Race tests are mandatory for these paths.
- **Portable SQL.** Storage sits behind a thin adapter (SQLite first, Postgres for production). No
  driver-specific SQL outside the adapter.
- Keys are stored normalized (dashes stripped, uppercased). One shared normalization helper for every
  endpoint.
- Webhook handlers verify signatures before parsing bodies, and are idempotent two ways:
  `provider_events` dedupe + `purchases.provider_checkout_id UNIQUE`.

## Reference material

- `temporal/keygate` — a Go license service we cloned for domain reference (gitignored). Look at
  `internal/license/token.go`, `internal/service/license.go`, and its migrations when in doubt about a
  domain decision. We copy ideas, never code (it's AGPL).
- `../pleasehold.dev` — sibling repo whose architecture conventions this project follows.

## Commands

- `npm run dev` — local dev server (Node)
- `npm test` — vitest
- `npm run check` — biome lint + format check
- `npm run typecheck` — tsc
