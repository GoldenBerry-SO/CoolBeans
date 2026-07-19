-- Stripe bookkeeping for an account's own Cool Beans subscription. Separate from the
-- purchases table, which records a *customer's* sales of their own software.
--
-- No plan column here: accounts.plan is the single source of the effective plan, and a
-- second copy would only be one more thing to drift out of step with it.
CREATE TABLE `account_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL UNIQUE,
	`stripe_customer_id` text UNIQUE,
	`stripe_subscription_id` text UNIQUE,
	`status` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`past_due_since` text,
	`last_event_at` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
