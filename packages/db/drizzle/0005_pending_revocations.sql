-- Out-of-order webhook reconciliation (issue #34). Stripe does not guarantee delivery
-- order, so a refund or dispute can arrive before the checkout that issued the key. The
-- terminal event parks its intent here and issuance applies it on arrival, instead of
-- handing out a working key for money already given back.
CREATE TABLE `pending_revocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`reference` text NOT NULL,
	`reason` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pending_revocations_ref` ON `pending_revocations` (`provider`,`reference`);