ALTER TABLE "organizations" ADD COLUMN "marketplace_hours" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_mime" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_data_base64" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_version" integer DEFAULT 0 NOT NULL;