-- Why a licence is disabled, as a set (issue #52 follow-up). A chargeback and a
-- cancellation can both be outstanding; winning the dispute clears one of them and must
-- not hand access back while the other still stands.
CREATE TABLE `license_revocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`license_id` integer NOT NULL,
	`cause` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`cleared_at` text,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_license_revocations_open` ON `license_revocations` (`license_id`,`cleared_at`);