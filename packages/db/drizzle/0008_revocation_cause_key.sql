-- A dispute and a refund on the same payment are two separate reasons to revoke.
-- Keyed on the reference alone they shared a row, so clearing the dispute (we won it)
-- threw the refund away and the checkout behind it issued a working key.
DROP INDEX `idx_pending_revocations_ref`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pending_revocations_ref` ON `pending_revocations` (`provider`,`reference`,`reason`);