CREATE TABLE `activations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`license_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_validated_at` text,
	`lease_expires_at` text,
	`deactivated_at` text,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activations_instance_id_unique` ON `activations` (`instance_id`);--> statement-breakpoint
CREATE INDEX `idx_activations_live` ON `activations` (`license_id`) WHERE "activations"."deactivated_at" IS NULL;--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`actor` text,
	`action` text NOT NULL,
	`license_id` integer,
	`detail` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`received_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `licenses` (
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
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `licenses_key_unique` ON `licenses` (`key`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`default_limit` integer,
	`reset_period` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_metrics_product_key` ON `metrics` (`product_id`,`key`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`license_id` integer NOT NULL,
	`metric_id` integer NOT NULL,
	`current` integer DEFAULT 0 NOT NULL,
	`limit_override` integer,
	`period_start` text DEFAULT (datetime('now')) NOT NULL,
	`resets_at` text,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`metric_id`) REFERENCES `metrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_usage_license_metric` ON `usage_counters` (`license_id`,`metric_id`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`run_after` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_pending` ON `outbox` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `products` (
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
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_key_prefix_unique` ON `products` (`key_prefix`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`provider_checkout_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_payment_id` text,
	`email` text NOT NULL,
	`amount_total` integer,
	`currency` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_checkout_id_unique` ON `purchases` (`provider_checkout_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_subscription` ON `purchases` (`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_payment` ON `purchases` (`provider_payment_id`);--> statement-breakpoint
CREATE TABLE `signing_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`algorithm` text DEFAULT 'ed25519' NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
