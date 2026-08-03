CREATE TABLE "validation_seen" (
	"product_id" integer NOT NULL,
	"day" text NOT NULL,
	"license_id" integer NOT NULL,
	CONSTRAINT "validation_seen_product_id_day_license_id_pk" PRIMARY KEY("product_id","day","license_id")
);
--> statement-breakpoint
ALTER TABLE "validation_counters" ADD COLUMN "refused" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "validation_seen" ADD CONSTRAINT "validation_seen_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_seen" ADD CONSTRAINT "validation_seen_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;