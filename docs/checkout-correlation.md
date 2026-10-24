# Opaque checkout correlation

Owner: payment integration maintainers. Supports GoldenBerry-SO/TideGlass #291
and GoldenBerry-SO/infra #259. This records correlation only; it does not send
analytics or establish a complete payment-to-activation funnel.

Stripe Payment Links accept a `client_reference_id` and include it in the checkout
session delivered to the webhook. A read-only HEAD check on 13 September 2026
confirmed that TideGlass's live `/buy` redirect preserves this parameter.
See [Stripe URL parameters](https://docs.stripe.com/payment-links/url-parameters).

## Contract

Clients can generate `gb_checkout_<UUID-v4>` for a new checkout attempt. The
48-character reference contains no installation, account, email or licence key.
The server accepts only that namespace and UUID shape, normalizes it to lowercase,
and stores it as `purchases.checkout_attempt_id` during initial issuance. Missing,
legacy and malformed values become null without blocking paid licence issuance.
Do not place private content in the provider reference field.

Migration `0011_checkout_attempt_reference` adds a nullable field; historical rows
remain unlinked. There is no backfill inferred from customers, email or timing.
Provider retries preserve the first stored reference, including null. References
are not unique: a buyer can create more than one checkout from the same attempt.
Use provider checkout/payment identity for deduplication and financial totals,
never the attempt reference. The reference is untrusted correlation data, not
proof of ownership, entitlement, payment or activation.

The frozen public client API is unchanged. Offline validation, seat enforcement,
price-to-grant resolution, signature verification and the existing issuance
transaction remain responsible for access. No telemetry network call is added to
issuance. Follow-up work must connect app-generated attempts, verified provider
outcomes and server-observed activation through a durable, tenant-scoped path;
never return or capture raw licence credentials as correlation identifiers.

## Validation and rollout

Parser and webhook tests cover canonicalization, private/malformed input rejection,
unchanged licence issuance and immutable correlation across provider retries.
Existing issuance rollback and plan-limit noninterference tests also pass.
The API/dependency build passes. Complete repository checks and the separate
payment-path review are required before merge. Deployment, live controlled
correlation and end-to-end activation reporting are still pending.
