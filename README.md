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

One codebase, two homes:

- **Self-host**, free forever. Node with PostgreSQL 16, up in one `docker compose up`.
- **Cloud** at [app.coolbeans.tools](https://app.coolbeans.tools), the same codebase run by us, with
  Stripe Connect so every vendor plugs in their own Stripe account.

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

**Docs live at [coolbeans.tools/docs](https://coolbeans.tools/docs)**: quickstart, self-hosting,
both SDKs, the CLI, the frozen HTTP contract, payments, webhooks, and offline behaviour. The full
spec is [`docs/PRD.md`](docs/PRD.md), architecture in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), design system in
[`docs/DESIGN.md`](docs/DESIGN.md), PRD coverage in [`docs/VALIDATION.md`](docs/VALIDATION.md).

## Self-host in one command

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD, ADMIN_TOKEN, SIGNING_KEY_SECRET, EMAIL_PROVIDER
docker compose up
```

`GET /health` answers `{ "ok": true }`, `GET /docs` serves the interactive API reference, and the
[self-hosting guide](https://coolbeans.tools/docs/self-hosting) covers every variable. Self-host is
unlimited: no caps, no feature flags held back.

## Repo layout

```
apps/
  api/          Hono API server (Node)
  worker/       BullMQ background-job processor
  web/          React SPA (Vite), the admin dashboard
  www/          Astro marketing site + docs, coolbeans.tools (Cloudflare Pages)
packages/
  auth/         Better Auth factory, admin sessions for the dashboard only
  cli/          beans, the admin CLI
  db/           Drizzle pg schema, postgres-js adapter, and the migrate CLI
  email/        React Email templates + Resend/SMTP sender seam
  logger/       Structured logger, zero deps
  sdk/          @coolbeans/sdk, one open() call on launch; Node, Electron, Tauri, browser
contract/       access-states.json, the access states every SDK must agree on
docs/           PRD and architecture notes
examples/       Copyable quickstarts, one per host
```

## Development

Prereqs: Node >= 22, pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm dev        # local dev server on :3000
pnpm test       # vitest
pnpm check      # biome lint + typecheck
```

## License

MIT. See [LICENSE](LICENSE).
