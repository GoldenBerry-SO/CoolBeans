---
layout: ../../layouts/DocsLayout.astro
title: The beans CLI
description: Admin over the Cool Beans HTTP API from a terminal, with --json for scripting.
---

`beans` is CLI-first admin over the Cool Beans HTTP API. Products, keys, Stripe onboarding and
purchase lookup, all with a `--json` flag so you can script any of it.

## Running it

**`@coolbeans/cli` is not on npm yet** (publishing is tracked in [#123](https://github.com/GoldenBerry-SO/coolbeans/issues/123)). Don't try `npm i -g @coolbeans/cli`, it won't resolve. Run
it from the repo:

```sh
pnpm install
pnpm --filter @coolbeans/cli build
node packages/cli/dist/index.js key issue --product clementine --email you@example.com
```

Every command needs to know where the server is and needs the admin token, so set
`COOLBEANS_URL` and `COOLBEANS_ADMIN_TOKEN` first (see [Global options](#global-options)) or pass
`--url` and `--token`. Without a token the CLI stops with `No admin token.`, and with no URL at all
it targets `http://localhost:3000`.

An alias makes the rest of this page copy-pasteable:

```sh
alias beans="node $PWD/packages/cli/dist/index.js"
```

During development you can skip the build with `pnpm --filter @coolbeans/cli dev <command>`, which
runs the TypeScript directly through tsx.

## Global options

Every command takes these:

| Option | What it does |
|---|---|
| `--url <url>` | Cool Beans server URL. Falls back to `COOLBEANS_URL`. |
| `--token <token>` | Admin bearer token. Falls back to `COOLBEANS_ADMIN_TOKEN`. |
| `--json` | Emit raw JSON for scripting instead of the human line. |

Set the two env vars once and forget them:

```sh
export COOLBEANS_URL=https://licences.example.com
export COOLBEANS_ADMIN_TOKEN=...   # the ADMIN_TOKEN from your instance config
```

## Products

### `beans product create`

```sh
beans product create \
  --slug clementine \
  --name Clementine \
  --prefix CLEM \
  --email-from "keys@example.com" \
  --limit 3 \
  --model node_locked
```

| Option | Required | Default | What it is |
|---|---|---|---|
| `--slug <slug>` | yes | | The product slug apps pass to the SDK. |
| `--name <name>` | yes | | Display name. |
| `--prefix <prefix>` | yes | | Key prefix, so keys look like `CLEM-XXXX-XXXX-XXXX-XXXX`. |
| `--email-from <email>` | yes | | The from address on key-delivery email. |
| `--limit <n>` | no | `3` | Activation limit, the seats a key gets by default. |
| `--model <model>` | no | `node_locked` | `node_locked` or `floating`. |

It prints the slug and key prefix. If the server returns a product token (used by a landing site's
success page to look up a purchase) it's shown **once**, so save it then.

### `beans product list`

```sh
beans product list
```

One line per product: slug, key prefix, activation limit.

## Keys

### `beans key issue`

```sh
beans key issue --product clementine --email buyer@example.com
```

| Option | Required | Default | What it is |
|---|---|---|---|
| `--product <slug>` | yes | | Which product to issue for. |
| `--email <email>` | yes | | The buyer. |
| `--kind <kind>` | no | `perpetual` | `perpetual`, `subscription` or `trial`. |
| `--plan <label>` | no | | Vendor plan label, display only. |
| `--seats <n>` | no | | Seats this licence gets. Omit to inherit the product default. |
| `--entitlements <json>` | no | | Capabilities this licence carries, e.g. `'{"export_4k":true,"batch_limit":100}'`. |
| `--trial-days <n>` | no | | Trial length in days. |

It prints the key. `--seats` is parsed before the request, so a typo is caught locally rather than
turning into a confusing server complaint.

### `beans key disable <key>` / `beans key enable <key>`

```sh
beans key disable CLEM-A2B3-C4D5-E6F7-H8JK
beans key enable  CLEM-A2B3-C4D5-E6F7-H8JK
```

Disabling is the one signal that revokes access in an app. Enabling restores it.

### `beans key extend <key>`

```sh
beans key extend CLEM-A2B3-C4D5-E6F7-H8JK --until 2027-08-03
```

`--until` is required, an ISO date or datetime. It's parsed before the request for the same reason
as `--seats`: an unparseable date would reach the server as "Invalid Date" and the complaint
wouldn't point at the typo.

### `beans key list`

```sh
beans key list --product clementine --status active
```

| Option | Required | What it is |
|---|---|---|
| `--product <slug>` | yes | Which product's keys. |
| `--status <status>` | no | Filter to `active` or `disabled`. |

One line per key: key, status, kind.

### `beans key show <key>`

```sh
beans key show CLEM-A2B3-C4D5-E6F7-H8JK
```

Prints the full licence record as JSON.

## Stripe

### `beans stripe connect`

```sh
beans stripe connect --product clementine \
  --webhook-url https://licences.example.com/v1/stripe/webhook
```

Registers the Stripe webhook endpoint for a product's connection and stores the signing secret.
Registration is its whole job. Both options are required.

It tells you the webhook path and whether a fresh signing secret was stored or the existing one was
kept. **Prices are mapped separately with grants**, either in the console under Stripe prices or by
posting to `/admin/products/<slug>/grants`. See [Payments](/docs/payments).

## Purchases

### `beans purchase`

```sh
beans purchase --email buyer@example.com
beans purchase --provider-id cs_test_...
```

Look up a purchase by buyer email or by the provider's id. Prints JSON.
