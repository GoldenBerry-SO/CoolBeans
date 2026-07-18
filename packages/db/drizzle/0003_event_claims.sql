-- Atomic provider-event claims (issue #34): a redelivered webhook must not be
-- processed twice. Existing rows are completed events, so they default to 'done'.
ALTER TABLE `provider_events` ADD `status` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_events` ADD `claimed_at` text;
