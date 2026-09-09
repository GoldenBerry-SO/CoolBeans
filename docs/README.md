# Cool Beans documentation

Two sets of documents live in this repository, and they have different jobs.

**Published docs**, for people using Cool Beans, are at
[coolbeans.tools/docs](https://coolbeans.tools/docs). Their source is
[`apps/www/src/pages/docs/`](../apps/www/src/pages/docs), and the site deploys from `main`.

**In-repo notes**, in this folder, are for people working on Cool Beans: the spec, the decisions
behind the code, and the commands a contributor runs.

## In this folder

| Document | What it covers |
|---|---|
| [PRD.md](PRD.md) | The full product spec. §9 is the frozen public client contract |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Engineering decisions, the Postgres traps, tenancy, platform billing |
| [development.md](development.md) | Every command a contributor runs, what each proves, and what needs Docker |
| [VALIDATION.md](VALIDATION.md) | Section-by-section check of the build against the PRD |
| [DESIGN.md](DESIGN.md) | The design system for the console and the customer portal |
| [OUTBOUND-WEBHOOKS.md](OUTBOUND-WEBHOOKS.md) | The lifecycle-event emitter, from the inside |
| [design/](design) | The approved console mockup DESIGN.md is derived from |

## Published pages

| Page | Source | What it covers |
|---|---|---|
| [What Cool Beans is](https://coolbeans.tools/docs) | [index.md](../apps/www/src/pages/docs/index.md) | The mental model and the one rule that matters |
| [Quickstart](https://coolbeans.tools/docs/quickstart) | [quickstart.md](../apps/www/src/pages/docs/quickstart.md) | Issue a key, wire up an app |
| [Self-hosting](https://coolbeans.tools/docs/self-hosting) | [self-hosting.md](../apps/www/src/pages/docs/self-hosting.md) | Compose, plus every configuration variable |
| [TypeScript SDK](https://coolbeans.tools/docs/sdk-typescript) | [sdk-typescript.md](../apps/www/src/pages/docs/sdk-typescript.md) | The full client surface |
| [Swift SDK](https://coolbeans.tools/docs/sdk-swift) | [sdk-swift.md](../apps/www/src/pages/docs/sdk-swift.md) | macOS and iOS |
| [The beans CLI](https://coolbeans.tools/docs/cli) | [cli.md](../apps/www/src/pages/docs/cli.md) | Every command and flag |
| [HTTP API](https://coolbeans.tools/docs/http-api) | [http-api.md](../apps/www/src/pages/docs/http-api.md) | The frozen contract, for languages with no SDK |
| [Payments](https://coolbeans.tools/docs/payments) | [payments.md](../apps/www/src/pages/docs/payments.md) | Prices, grants, and what the webhook does |
| [Outbound webhooks](https://coolbeans.tools/docs/webhooks) | [webhooks.md](../apps/www/src/pages/docs/webhooks.md) | Lifecycle events for your own systems |
| [Offline verification](https://coolbeans.tools/docs/offline) | [offline.md](../apps/www/src/pages/docs/offline.md) | Tokens, grace, air-gapped machines |
| [Migrating from LemonSqueezy](https://coolbeans.tools/docs/migrate-from-lemonsqueezy) | [migrate-from-lemonsqueezy.md](../apps/www/src/pages/docs/migrate-from-lemonsqueezy.md) | Parity routes and the migration path |

## Which document wins

- On the **public client contract**, PRD §9 is authoritative. The published HTTP API page describes
  the same surface for readers; if the two disagree, §9 is right and the page is a bug.
- On **outbound webhooks**, the published page is the fuller version. `OUTBOUND-WEBHOOKS.md` is the
  internal note, and the two are kept in step by hand.
- On **the console and portal look**, `DESIGN.md` records the tokens and
  `apps/web/src/index.css` implements them. Change the CSS, then document it here.

## Elsewhere in the repo

[CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose a change, [SECURITY.md](../SECURITY.md)
for reporting a vulnerability, [CLAUDE.md](../CLAUDE.md) for the ground rules and the review
practice, and READMEs in [`packages/sdk`](../packages/sdk/README.md),
[`packages/cli`](../packages/cli/README.md) and [`examples/`](../examples/README.md).
