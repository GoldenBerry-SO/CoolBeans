CREATE TABLE "stripe_connect_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"state_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "stripe_connect_states_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "ck_stripe_connect_states_expiry" CHECK ("stripe_connect_states"."expires_at" > "stripe_connect_states"."created_at")
);
--> statement-breakpoint
ALTER TABLE "stripe_connect_states" ADD CONSTRAINT "stripe_connect_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_states_account" ON "stripe_connect_states" USING btree ("account_id");