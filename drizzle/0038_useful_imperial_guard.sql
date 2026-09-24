CREATE TYPE "public"."asaas_connection_status" AS ENUM('conectada', 'com_erro');--> statement-breakpoint
CREATE TYPE "public"."asaas_environment" AS ENUM('producao', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."booking_payment_status" AS ENUM('nao_exigido', 'aguardando', 'pago', 'vencido', 'estornado');--> statement-breakpoint
CREATE TABLE "asaas_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"api_key" text NOT NULL,
	"environment" "asaas_environment" NOT NULL,
	"account_name" text,
	"account_email" text,
	"webhook_token" text NOT NULL,
	"asaas_webhook_id" text,
	"status" "asaas_connection_status" DEFAULT 'conectada' NOT NULL,
	"status_detail" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asaas_accounts_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "asaas_accounts_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_status" "booking_payment_status" DEFAULT 'nao_exigido' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_url" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "asaas_payment_link_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "asaas_payment_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "require_payment_to_book" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_deposit_percent" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payment_hold_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "asaas_accounts" ADD CONSTRAINT "asaas_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asaas_accounts_org_idx" ON "asaas_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "appointments_pagamento_vencendo_idx" ON "appointments" USING btree ("payment_status","payment_due_at");--> statement-breakpoint
CREATE INDEX "appointments_asaas_link_idx" ON "appointments" USING btree ("asaas_payment_link_id");