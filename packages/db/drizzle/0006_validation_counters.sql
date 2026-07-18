-- Validation traffic for the Overview chart (issue #37). An aggregate rather than a log:
-- validate is the hot path, so one upsert per check keeps this O(products x days)
-- instead of growing a row for every validation a customer's app ever makes.
CREATE TABLE `validation_counters` (
	`product_id` integer NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`product_id`, `day`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
