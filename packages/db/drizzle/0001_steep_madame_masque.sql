ALTER TABLE `outbox` ADD `claimed_at` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`activation_limit` integer DEFAULT 3 NOT NULL,
	`activation_model` text DEFAULT 'node_locked' NOT NULL,
	`floating_lease_minutes` integer DEFAULT 30 NOT NULL,
	`email_from` text NOT NULL,
	`download_url` text,
	`stripe_price_lifetime` text,
	`stripe_price_yearly` text,
	`stripe_webhook_secret` text,
	`paypal_plan_yearly` text,
	`paypal_sku_lifetime` text,
	`product_token_hash` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "ck_products_activation_model" CHECK("__new_products"."activation_model" IN ('node_locked','floating'))
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "slug", "name", "key_prefix", "activation_limit", "activation_model", "floating_lease_minutes", "email_from", "download_url", "stripe_price_lifetime", "stripe_price_yearly", "stripe_webhook_secret", "paypal_plan_yearly", "paypal_sku_lifetime", "product_token_hash", "created_at") SELECT "id", "slug", "name", "key_prefix", "activation_limit", "activation_model", "floating_lease_minutes", "email_from", "download_url", "stripe_price_lifetime", "stripe_price_yearly", "stripe_webhook_secret", "paypal_plan_yearly", "paypal_sku_lifetime", NULL, "created_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_key_prefix_unique` ON `products` (`key_prefix`);--> statement-breakpoint
CREATE TABLE `__new_licenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`purchase_id` integer NOT NULL,
	`key` text NOT NULL,
	`tier` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text,
	`disabled_at` text,
	`disabled_reason` text,
	`email_sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_licenses_tier" CHECK("__new_licenses"."tier" IN ('lifetime','yearly','trial')),
	CONSTRAINT "ck_licenses_status" CHECK("__new_licenses"."status" IN ('active','disabled'))
);
--> statement-breakpoint
INSERT INTO `__new_licenses`("id", "product_id", "purchase_id", "key", "tier", "status", "expires_at", "disabled_at", "disabled_reason", "email_sent_at", "created_at") SELECT "id", "product_id", "purchase_id", "key", "tier", "status", "expires_at", "disabled_at", "disabled_reason", "email_sent_at", "created_at" FROM `licenses`;--> statement-breakpoint
DROP TABLE `licenses`;--> statement-breakpoint
ALTER TABLE `__new_licenses` RENAME TO `licenses`;--> statement-breakpoint
CREATE UNIQUE INDEX `licenses_key_unique` ON `licenses` (`key`);