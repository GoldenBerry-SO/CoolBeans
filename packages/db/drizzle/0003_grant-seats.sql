ALTER TABLE "license_grants" ADD COLUMN "activation_limit" integer;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "activation_limit" integer;--> statement-breakpoint
ALTER TABLE "license_grants" ADD CONSTRAINT "ck_license_grants_seats" CHECK ("license_grants"."activation_limit" IS NULL OR "license_grants"."activation_limit" > 0);--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "ck_licenses_seats" CHECK ("licenses"."activation_limit" IS NULL OR "licenses"."activation_limit" > 0);