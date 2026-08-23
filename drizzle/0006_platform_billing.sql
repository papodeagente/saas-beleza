CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."payment_provider_kind" AS ENUM('hotmart', 'asaas', 'pagarme', 'cakto', 'stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."platform_charge_status" AS ENUM('pending', 'paid', 'refunded', 'chargeback', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_event_kind" AS ENUM('trial_started', 'trial_converted', 'created', 'renewed', 'upgraded', 'downgraded', 'cycle_changed', 'past_due', 'recovered', 'canceled', 'reactivated');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'canceled');--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "payment_provider_kind" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_token_hash" text,
	"webhook_token_hint" text,
	"credentials" jsonb,
	"config" jsonb,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"monthly_price_cents" integer NOT NULL,
	"yearly_price_cents" integer NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"max_branches" integer,
	"max_professionals" integer,
	"max_users" integer,
	"features" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"granted_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_charges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"subscription_id" bigint,
	"provider_id" bigint,
	"status" "platform_charge_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"external_id" text,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider_id" bigint,
	"kind" "payment_provider_kind" NOT NULL,
	"external_id" text,
	"event_name" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"subscription_id" bigint,
	"kind" "subscription_event_kind" NOT NULL,
	"mrr_before_cents" integer DEFAULT 0 NOT NULL,
	"mrr_after_cents" integer DEFAULT 0 NOT NULL,
	"plan_id_before" bigint,
	"plan_id_after" bigint,
	"source" text DEFAULT 'system' NOT NULL,
	"note" text,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"plan_id" bigint NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"price_cents" integer NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"provider_id" bigint,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_charges" ADD CONSTRAINT "platform_charges_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_webhook_events" ADD CONSTRAINT "platform_webhook_events_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_providers_kind_unique" ON "payment_providers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "platform_charges_org_idx" ON "platform_charges" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_webhook_received_idx" ON "platform_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_webhook_external_unique" ON "platform_webhook_events" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "subscription_events_occurred_idx" ON "subscription_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "subscription_events_org_idx" ON "subscription_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");