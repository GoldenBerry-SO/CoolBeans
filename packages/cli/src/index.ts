#!/usr/bin/env node
// ABOUTME: The beans CLI (PRD §16) — CLI-first admin over the Cool Beans HTTP API.
// ABOUTME: Subcommands for products, keys, and purchases; --json for scripting.

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { apiRequest, type ClientOptions, resolveClient } from './client.js';
import { parseEntitlementsFlag, parseSeatsFlag } from './entitlements-flag.js';

/**
 * Read the version off our own manifest rather than hardcoding it. A literal here went
 * stale the moment the package was versioned for release, so `beans --version` reported
 * 0.0.0 from a 0.1.0 install, which makes every bug report from the field misleading.
 *
 * createRequire, not a JSON import: the bundle is ESM and a static import of package.json
 * would be inlined at build time, which is the same staleness by another route. From
 * dist/index.js this resolves to the package root, where npm always ships package.json.
 */
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const program = new Command();

program
	.name('beans')
	.description('Cool Beans admin CLI. Issue a key, activate it, check it is still good.')
	.version(version)
	.option('--url <url>', 'Cool Beans server URL (or COOLBEANS_URL)')
	.option('--token <token>', 'Admin bearer token (or COOLBEANS_ADMIN_TOKEN)')
	.option('--json', 'Emit raw JSON for scripting');

function ctx(command: Command): { client: ClientOptions; json: boolean } {
	const opts = command.optsWithGlobals();
	return { client: resolveClient(opts), json: !!opts.json };
}

function out(json: boolean, human: string, data: unknown): void {
	if (json) console.log(JSON.stringify(data, null, 2));
	else console.log(human);
}

function fail(err: unknown): never {
	console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}

const product = program.command('product').description('Manage products');

product
	.command('create')
	.requiredOption('--slug <slug>')
	.requiredOption('--name <name>')
	.requiredOption('--prefix <prefix>')
	.requiredOption('--email-from <email>')
	.option('--limit <n>', 'Activation limit', '3')
	.option('--model <model>', 'node_locked | floating', 'node_locked')
	.action(async (opts, cmd) => {
		const { client, json } = ctx(cmd);
		try {
			const res = (await apiRequest(client, 'POST', '/admin/products', {
				slug: opts.slug,
				name: opts.name,
				key_prefix: opts.prefix,
				email_from: opts.emailFrom,
				activation_limit: Number(opts.limit),
				activation_model: opts.model,
			})) as { product: { slug: string; keyPrefix: string }; product_token?: string };
			out(
				json,
				`Created product ${res.product.slug} (${res.product.keyPrefix})${
					res.product_token
						? `\nProduct token (shown once, for the success page): ${res.product_token}`
						: ''
				}`,
				res,
			);
		} catch (err) {
			fail(err);
		}
	});

product.command('list').action(async (_opts, cmd) => {
	const { client, json } = ctx(cmd);
	try {
		const res = (await apiRequest(client, 'GET', '/admin/products')) as {
			products: Array<{ slug: string; keyPrefix: string; activationLimit: number }>;
		};
		out(
			json,
			res.products.map((p) => `${p.slug}  ${p.keyPrefix}  limit=${p.activationLimit}`).join('\n') ||
				'No products.',
			res,
		);
	} catch (err) {
		fail(err);
	}
});

const key = program.command('key').description('Manage license keys');

key
	.command('issue')
	.requiredOption('--product <slug>')
	.requiredOption('--email <email>')
	.option('--kind <kind>', 'perpetual | subscription | trial', 'perpetual')
	.option('--plan <label>', 'Optional vendor plan label (display only)')
	.option('--seats <n>', 'Seats this licence gets (omit to inherit the product default)')
	.option(
		'--entitlements <json>',
		'Capabilities this licence carries, e.g. \'{"export_4k":true,"batch_limit":100}\'',
	)
	.option('--trial-days <n>', 'Trial length in days')
	.action(async (opts, cmd) => {
		const { client, json } = ctx(cmd);
		try {
			const res = (await apiRequest(client, 'POST', '/admin/keys', {
				product: opts.product,
				email: opts.email,
				kind: opts.kind,
				...(opts.plan ? { plan: opts.plan } : {}),
				// Checked here: Number('abc') is NaN, which JSON turns into null, and the server's
				// complaint about null seats would point everywhere except at the typo.
				...(opts.seats ? { activation_limit: parseSeatsFlag(opts.seats) } : {}),
				...(opts.entitlements ? { entitlements: parseEntitlementsFlag(opts.entitlements) } : {}),
				...(opts.trialDays ? { trial_days: Number(opts.trialDays) } : {}),
			})) as { key: string };
			out(json, res.key, res);
		} catch (err) {
			fail(err);
		}
	});

key.command('disable <key>').action(async (keyArg, _opts, cmd) => {
	const { client, json } = ctx(cmd);
	try {
		const res = await apiRequest(
			client,
			'POST',
			`/admin/keys/${encodeURIComponent(keyArg)}/disable`,
		);
		out(json, `Disabled ${keyArg}`, res);
	} catch (err) {
		fail(err);
	}
});

key
	.command('extend <key>')
	.requiredOption('--until <date>', 'New expiry, ISO date or datetime (e.g. 2027-08-03)')
	.action(async (keyArg, opts, cmd) => {
		const { client, json } = ctx(cmd);
		// Checked here for the same reason as --seats: an unparseable date would reach the
		// server as "Invalid Date" and the complaint would not point at the typo.
		const until = new Date(opts.until);
		if (Number.isNaN(until.getTime())) {
			fail(new Error(`--until is not a date I can read: ${opts.until}`));
			return;
		}
		try {
			const res = await apiRequest(
				client,
				'POST',
				`/admin/keys/${encodeURIComponent(keyArg)}/extend`,
				{ expires_at: until.toISOString() },
			);
			out(json, `Extended ${keyArg} until ${until.toISOString()}`, res);
		} catch (err) {
			fail(err);
		}
	});

key.command('enable <key>').action(async (keyArg, _opts, cmd) => {
	const { client, json } = ctx(cmd);
	try {
		const res = await apiRequest(
			client,
			'POST',
			`/admin/keys/${encodeURIComponent(keyArg)}/enable`,
		);
		out(json, `Enabled ${keyArg}`, res);
	} catch (err) {
		fail(err);
	}
});

key
	.command('list')
	.requiredOption('--product <slug>')
	.option('--status <status>', 'active | disabled')
	.action(async (opts, cmd) => {
		const { client, json } = ctx(cmd);
		try {
			const q = opts.status ? `?status=${opts.status}` : '';
			const res = (await apiRequest(client, 'GET', `/admin/products/${opts.product}/keys${q}`)) as {
				keys: Array<{ key: string; status: string; kind: string }>;
			};
			out(
				json,
				res.keys.map((k) => `${k.key}  ${k.status}  ${k.kind}`).join('\n') || 'No keys.',
				res,
			);
		} catch (err) {
			fail(err);
		}
	});

key.command('show <key>').action(async (keyArg, _opts, cmd) => {
	const { client, json } = ctx(cmd);
	try {
		const res = await apiRequest(client, 'GET', `/admin/keys/${encodeURIComponent(keyArg)}`);
		out(json, JSON.stringify(res, null, 2), res);
	} catch (err) {
		fail(err);
	}
});

const stripe = program.command('stripe').description('Stripe onboarding');

stripe
	.command('connect')
	.description('Register the Stripe webhook for a product (prices are mapped with grants)')
	.requiredOption('--product <slug>')
	.requiredOption('--webhook-url <url>')
	.action(async (opts, cmd) => {
		const { client, json } = ctx(cmd);
		try {
			const res = (await apiRequest(
				client,
				'POST',
				`/admin/products/${opts.product}/stripe/connect`,
				{ webhook_url: opts.webhookUrl },
			)) as { webhook_path: string; secret_rotated: boolean; note?: string };
			out(
				json,
				res.note ??
					`Webhook wired for ${opts.product} at ${res.webhook_path}.` +
						(res.secret_rotated
							? ' A fresh signing secret was stored.'
							: ' The stored signing secret was kept.') +
						' Map prices in the console (Stripe prices) or POST /admin/products/<slug>/grants.',
				res,
			);
		} catch (err) {
			fail(err);
		}
	});

program
	.command('purchase')
	.description('Look up a purchase by email or provider id')
	.option('--email <email>')
	.option('--provider-id <id>')
	.action(async (opts, cmd) => {
		const { client, json } = ctx(cmd);
		try {
			const params = new URLSearchParams();
			if (opts.email) params.set('email', opts.email);
			if (opts.providerId) params.set('provider_id', opts.providerId);
			const res = await apiRequest(client, 'GET', `/admin/purchases?${params.toString()}`);
			out(json, JSON.stringify(res, null, 2), res);
		} catch (err) {
			fail(err);
		}
	});

program.parseAsync();
