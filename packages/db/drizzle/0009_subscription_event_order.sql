-- Stripe does not guarantee delivery order and retries for days, so a stale
-- subscription event can arrive after the one that superseded it. Remember the newest
-- we have applied (issue #54) and ignore anything older.
ALTER TABLE `purchases` ADD `last_subscription_event_at` integer;