# @coolbeans/cli

`beans` is admin for [Cool Beans](https://coolbeans.tools) from a terminal. Products, licence
keys, Stripe wiring and purchase lookup, with `--json` on everything so you can script it.

Cool Beans is the open source licensing layer: it turns Stripe and PayPal payments into licence
keys and answers whether a key is still good. MIT, self-hostable with one `docker compose up`.

```sh
npm i -g @coolbeans/cli
```

## Point it at your instance

Every command needs a server URL and an admin token. Set them once:

```sh
export COOLBEANS_URL=https://licences.example.com
export COOLBEANS_ADMIN_TOKEN=...   # the ADMIN_TOKEN from your instance config
```

Or pass `--url` and `--token` per command. Without a token the CLI stops with
`No admin token.` rather than sending an unauthenticated request, and with no URL it targets
`http://localhost:3000`.

The hosted cloud does not use `ADMIN_TOKEN` (it is a global bypass with no account behind it,
which has no place in a multi-tenant instance), so the CLI is for self-hosted instances. On cloud,
use the console.

## Common commands

```sh
# Create a product
beans product create --slug clementine --name Clementine --prefix CLEM \
  --email-from keys@example.com --limit 3 --model node_locked

# Issue a key and email it to the buyer
beans key issue --product clementine --email buyer@example.com

# A subscription key with a plan label, seats and capabilities
beans key issue --product clementine --email buyer@example.com \
  --kind subscription --plan "Pro yearly" --seats 5 \
  --entitlements '{"export_4k":true}'

# Revoke and restore
beans key disable CLEM-A2B3-C4D5-E6F7-H8JK
beans key enable  CLEM-A2B3-C4D5-E6F7-H8JK

# Move an expiry, so a manual yearly can renew
beans key extend CLEM-A2B3-C4D5-E6F7-H8JK --until 2027-08-03

# Look things up
beans key list --product clementine --status active
beans key show CLEM-A2B3-C4D5-E6F7-H8JK
beans purchase --email buyer@example.com
```

Add `--json` to any of these to get the raw response instead of the human line.

## Full reference

Every command and flag: [coolbeans.tools/docs/cli](https://coolbeans.tools/docs/cli)

## License

MIT
