# Security policy

Cool Beans issues and validates software licences, so bugs here can lock paying users out of
software they bought, or let non-payers in. We take reports seriously and we're grateful for them.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Use GitHub's private reporting: [Report a vulnerability](https://github.com/GoldenBerry-SO/coolbeans/security/advisories/new),
or email hello@coolbeans.tools if you prefer.

You'll get an acknowledgment within a few days. We'll keep you in the loop while we fix it, and
credit you in the advisory unless you'd rather stay anonymous.

## Scope

In scope: this repository, the hosted service at app.coolbeans.tools and coolbeans.tools, the
`@coolbeans/sdk` package, and the Swift SDK at
[coolbeans-swift](https://github.com/GoldenBerry-SO/coolbeans-swift).

Especially interesting: anything that lets a key validate when it shouldn't (or the reverse),
webhook signature bypasses, cross-tenant data access on the cloud, and offline-token forgery.

## Supported versions

The `main` branch and the latest release. Self-hosters should track releases.
