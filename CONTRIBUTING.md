# Contributing to Cool Beans

Thanks for wanting to help. This page covers how to get a dev environment running, what we expect
from changes, and the few rules that keep a licensing service trustworthy.

## Dev setup

Prereqs: Node >= 22, pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm dev        # local dev server on :3000
pnpm test       # vitest
pnpm check      # biome lint + typecheck
```

`pnpm test` runs against PGlite, so you don't need a database installed. The compose stack
(`docker compose up`) gives you the full thing with PostgreSQL and Redis if you want it.

## Before you open a PR

- **Tests come with the change.** We practice TDD here: write the failing test first, then the code
  that makes it pass. A PR without tests for its behaviour will be asked for them.
- `pnpm test`, `pnpm check`, and `pnpm typecheck` all green.
- Keep PRs small and focused. One change per PR merges fast.
- Match the style of the file you're in. Biome enforces most of it.

## The rules that are not up for debate

These protect paying end users of the products built on Cool Beans, so they get extra scrutiny:

1. **PRD §9 is a frozen contract.** The public client API shapes (activate, validate, deactivate,
   heartbeat, usage) must not change. Products ship against them.
2. **Offline-tolerant by contract.** An unknown key is `404`, never `disabled`. Only an explicit
   `disabled` revokes access. No change may lock out an offline user.
3. **The key is the credential.** Public endpoints carry no service secret.
4. **Atomic limit enforcement.** Seats, leases, and quotas are enforced in single guarded SQL
   statements, never read-then-write. Race tests are mandatory on these paths, and changes here
   get an extra concurrency review before merge.
5. **Portable SQL.** Storage sits behind the adapter in `packages/db`. No driver-specific SQL
   outside it.

If your change touches any of those areas, say so in the PR description and expect the review to
take longer.

## Finding something to work on

Issues labeled `good first issue` are scoped for newcomers, and `help wanted` marks things we'd
love a hand with. If you want to build something bigger, open an issue first so we can agree on
the shape before you spend your weekend on it.

## Security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).
