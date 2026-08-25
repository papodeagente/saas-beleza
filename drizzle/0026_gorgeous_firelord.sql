ALTER TABLE "conversations" ADD COLUMN "provider_preview" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_preview_type" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_last_sender" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_unread" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "provider_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_preview" text;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_preview_type" text;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_last_sender" text;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_unread" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD COLUMN "provider_synced_at" timestamp with time zone;