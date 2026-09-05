ALTER TYPE "public"."billing_cycle" ADD VALUE 'quarterly' BEFORE 'yearly';--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT "plans_checkout_urls_https";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "quarterly_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "checkout_url_quarterly" text;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_checkout_urls_https" CHECK (("plans"."checkout_url_monthly" is null or "plans"."checkout_url_monthly" like 'https://%')
        and ("plans"."checkout_url_quarterly" is null or "plans"."checkout_url_quarterly" like 'https://%')
        and ("plans"."checkout_url_yearly" is null or "plans"."checkout_url_yearly" like 'https://%'));