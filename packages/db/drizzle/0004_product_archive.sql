-- Product archiving (issue #38). Never a row delete: the frozen §9 contract says
-- issued keys keep validating, so retiring a product only stops new issuance.
ALTER TABLE `products` ADD `archived_at` text;
