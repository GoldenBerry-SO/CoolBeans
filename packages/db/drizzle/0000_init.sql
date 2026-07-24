CREATE TABLE "account_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text,
	"current_period_end" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"past_due_since" text,
	"last_event_at" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "account_subscriptions_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "account_subscriptions_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "account_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"product_limit" integer,
	"active_license_limit" integer,
	"over_limit_since" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "ck_accounts_plan" CHECK ("accounts"."plan" IN ('free','pro'))
);
--> statement-breakpoint
CREATE TABLE "activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"license_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_validated_at" text,
	"lease_expires_at" text,
	"deactivated_at" text,
	CONSTRAINT "activations_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"account_id" integer DEFAULT 1 NOT NULL,
	"admin_user_id" integer NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_login_at" text,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer DEFAULT 1 NOT NULL,
	"product_id" integer,
	"actor" text,
	"action" text NOT NULL,
	"license_id" integer,
	"detail" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" integer,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"claimed_at" text,
	"claim_token" text,
	"received_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"stripe_connection_id" integer NOT NULL,
	"stripe_price_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"kind" text NOT NULL,
	"plan" text,
	"status" text DEFAULT 'active' NOT NULL,
	"retired_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "uq_license_grants_connection_price" UNIQUE("stripe_connection_id","stripe_price_id"),
	CONSTRAINT "ck_license_grants_kind" CHECK ("license_grants"."kind" IN ('perpetual','subscription')),
	CONSTRAINT "ck_license_grants_status" CHECK ("license_grants"."status" IN ('active','retired'))
);
--> statement-breakpoint
CREATE TABLE "license_revocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" integer NOT NULL,
	"cause" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"cleared_at" text
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"purchase_id" integer NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"plan" text,
	"issued_grant_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"disabled_at" text,
	"disabled_reason" text,
	"email_sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "licenses_key_unique" UNIQUE("key"),
	CONSTRAINT "ck_licenses_kind" CHECK ("licenses"."kind" IN ('perpetual','subscription','trial')),
	CONSTRAINT "ck_licenses_status" CHECK ("licenses"."status" IN ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "stripe_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"mode" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"webhook_secret" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "uq_stripe_connections_account" UNIQUE("stripe_account_id"),
	CONSTRAINT "uq_stripe_connections_tenant" UNIQUE("account_id","id"),
	CONSTRAINT "ck_stripe_connections_mode" CHECK ("stripe_connections"."mode" IN ('cloud_connect','self_host_default')),
	CONSTRAINT "ck_stripe_connections_status" CHECK ("stripe_connections"."status" IN ('active','disconnected','disabled'))
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"default_limit" integer,
	"reset_period" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "uq_metrics_product_key" UNIQUE("product_id","key")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" integer NOT NULL,
	"metric_id" integer NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"limit_override" integer,
	"period_start" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"resets_at" text,
	CONSTRAINT "uq_usage_license_metric" UNIQUE("license_id","metric_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" text,
	"run_after" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"processed_at" text
);
--> statement-breakpoint
CREATE TABLE "pending_revocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"event_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"consumed_at" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer DEFAULT 1 NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"activation_limit" integer DEFAULT 3 NOT NULL,
	"activation_model" text DEFAULT 'node_locked' NOT NULL,
	"floating_lease_minutes" integer DEFAULT 30 NOT NULL,
	"email_from" text NOT NULL,
	"download_url" text,
	"paypal_plan_yearly" text,
	"paypal_sku_lifetime" text,
	"product_token_hash" text,
	"archived_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "uq_products_tenant" UNIQUE("account_id","id"),
	CONSTRAINT "ck_products_activation_model" CHECK ("products"."activation_model" IN ('node_locked','floating'))
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"stripe_connection_id" integer,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_checkout_id" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"provider_payment_id" text,
	"email" text NOT NULL,
	"amount_total" integer,
	"currency" text,
	"note" text,
	"last_subscription_event_at" integer,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "purchases_provider_checkout_id_unique" UNIQUE("provider_checkout_id")
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer,
	"algorithm" text DEFAULT 'ed25519' NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_counters" (
	"product_id" integer NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "validation_counters_product_id_day_pk" PRIMARY KEY("product_id","day")
);
--> statement-breakpoint
ALTER TABLE "account_subscriptions" ADD CONSTRAINT "account_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_grants" ADD CONSTRAINT "license_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_grants" ADD CONSTRAINT "fk_license_grants_connection" FOREIGN KEY ("account_id","stripe_connection_id") REFERENCES "public"."stripe_connections"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_grants" ADD CONSTRAINT "fk_license_grants_product" FOREIGN KEY ("account_id","product_id") REFERENCES "public"."products"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_revocations" ADD CONSTRAINT "license_revocations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_issued_grant_id_license_grants_id_fk" FOREIGN KEY ("issued_grant_id") REFERENCES "public"."license_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connections" ADD CONSTRAINT "stripe_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_stripe_connection_id_stripe_connections_id_fk" FOREIGN KEY ("stripe_connection_id") REFERENCES "public"."stripe_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_counters" ADD CONSTRAINT "validation_counters_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activations_live" ON "activations" USING btree ("license_id") WHERE "activations"."deactivated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_admin_sessions_user" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_codes_email" ON "auth_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_audit_account" ON "audit_log" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "idx_license_grants_product_status" ON "license_grants" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "idx_license_revocations_open" ON "license_revocations" USING btree ("license_id","cleared_at");--> statement-breakpoint
CREATE INDEX "idx_licenses_product_status" ON "licenses" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "idx_outbox_pending" ON "outbox" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pending_revocations_ref" ON "pending_revocations" USING btree ("provider","reference","reason");--> statement-breakpoint
CREATE INDEX "idx_products_account" ON "products" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_subscription" ON "purchases" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_payment" ON "purchases" USING btree ("provider_payment_id");--> statement-breakpoint
-- The single account a self-host runs as, and the one every admin test assumes exists.
-- Pro because self-host is unlimited; billing being configured is what makes an instance
-- "cloud". limitsFor() reads this row.
INSERT INTO "accounts" ("id", "name", "plan") VALUES (1, 'Default account', 'pro')
	ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT setval('accounts_id_seq', (SELECT MAX("id") FROM "accounts"), true);--> statement-breakpoint
-- The default self-host Stripe connection. A self-host instance rebinds its stripe_account_id
-- from STRIPE_SECRET_KEY at boot; cloud vendors create their own connections via Stripe Connect
-- and never use this one. Seeded so grants and the webhook path have a connection to hang off.
INSERT INTO "stripe_connections" ("id", "account_id", "provider", "mode", "stripe_account_id", "livemode", "status")
	VALUES (1, 1, 'stripe', 'self_host_default', 'acct_self_host', false, 'active')
	ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT setval('stripe_connections_id_seq', (SELECT MAX("id") FROM "stripe_connections"), true);
