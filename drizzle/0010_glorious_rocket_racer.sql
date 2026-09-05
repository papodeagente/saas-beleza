CREATE TABLE "signup_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"email" text,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "public_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "highlight" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "highlight_label" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "cta_label" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "checkout_url_monthly" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "checkout_url_yearly" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "signup_attempts_ip_idx" ON "signup_attempts" USING btree ("ip","created_at");