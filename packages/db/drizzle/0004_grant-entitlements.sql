ALTER TABLE "license_grants" ADD COLUMN "entitlements" jsonb;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "entitlements" jsonb;