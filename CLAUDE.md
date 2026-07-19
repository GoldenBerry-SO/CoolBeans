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
- **Tenancy: cross-account is 404, never 403.** Admin handlers resolve products through
  `requireProduct`, which scopes to the caller's account. A 403 would confirm the thing exists in
  someone else's account. The public `/v1` surface is never account-scoped.
- **Plan limits never touch the frozen path.** Nothing in `services/licensing.ts` consults a plan,
  and webhook-driven issuance never refuses — money has already changed hands, so we issue past the
  cap and record it. `test/limits-never-lock-out.test.ts` is the guard; if it fails, the change is
  wrong, not the test.
- **Self-host is unlimited**, and gets there through the same `limitsFor()` call the plans use.
  Billing being configured is the only thing that makes an instance "cloud".
- `BILLING_*` (us charging customers) and `STRIPE_*` (a customer selling their software) are
  separate namespaces on separate Stripe accounts. Never reuse one for the other.
- Webhook handlers verify signatures before parsing bodies, and are idempotent two ways:
  `provider_events` dedupe + `purchases.provider_checkout_id UNIQUE`.

## Review practice

Anything touching concurrency or exactly-once behaviour — webhook/event claims, activation
seats, usage quotas, floating leases, throttles — gets an OpenAI Codex review before it
merges:

```
npx @openai/codex review --base main -c model_reasoning_effort="xhigh"
```

This is in addition to TDD, not instead of it. It earned its place: Codex twice found real
defects in concurrency code that already had passing tests, because those tests exercised
the interleavings the author had already thought of. Verify each finding against the code
before acting — it over-reports occasionally. When a race can't be staged against the
synchronous SQLite driver, extract the decision into a pure function and test that, rather
than shipping a test that can't fail.

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
