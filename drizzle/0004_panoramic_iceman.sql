ALTER TABLE "whatsapp_connections" ADD COLUMN "pairing_qr_code" text;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "pairing_code" text;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD COLUMN "pairing_updated_at" timestamp with time zone;