ALTER TABLE "appointments" ADD COLUMN "payment_token" text;--> statement-breakpoint
ALTER TABLE "asaas_accounts" ADD COLUMN "pix_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "document" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "asaas_customer_id" text;--> statement-breakpoint
CREATE INDEX "appointments_asaas_pagamento_idx" ON "appointments" USING btree ("asaas_payment_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_payment_token_unique" UNIQUE("payment_token");