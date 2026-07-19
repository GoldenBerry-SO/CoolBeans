-- Multi-tenancy. Products and admin users belong to an account; the hosted plan and its
-- limits hang off the account. Self-host stays single-account and unlimited.
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`product_limit` integer,
	`active_license_limit` integer,
	`over_limit_since` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `ck_accounts_plan` CHECK (`plan` IN ('free','pro'))
);
--> statement-breakpoint
-- Account 1 always exists. It owns every pre-tenancy row, and it is the single account a
-- fresh self-host or test database starts with, so "exactly one account" resolves
-- deterministically without a signup step. Grandfathered to 'pro': an instance that was
-- running before this migration must not wake up capped at one product.
INSERT OR IGNORE INTO `accounts` (`id`, `name`, `plan`) VALUES (1, 'Default account', 'pro');
--> statement-breakpoint
-- NOT NULL DEFAULT 1 backfills every existing row in one statement. No REFERENCES clause
-- on any of these: SQLite refuses a non-NULL default on an added foreign-key column while
-- foreign_keys is ON (and the pragma cannot be turned off inside the migrator's
-- transaction), while the usual rebuild-the-table workaround is unsafe here because six
-- tables reference products. node.ts asserts at boot that every account_id resolves.
ALTER TABLE `products` ADD `account_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `account_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `account_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `account_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Nullable: an event can fail before any product, and so any account, is known.
ALTER TABLE `provider_events` ADD `account_id` integer;--> statement-breakpoint
CREATE INDEX `idx_products_account` ON `products` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_admin_users_account` ON `admin_users` (`account_id`);--> statement-breakpoint
-- Serves the active-licence count that the plan limit is enforced against.
CREATE INDEX `idx_licenses_product_status` ON `licenses` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_audit_account` ON `audit_log` (`account_id`,`id`);
