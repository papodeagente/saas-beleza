DO $$ BEGIN
	CREATE TYPE "public"."automation_dispatch_status" AS ENUM('processing', 'sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."automation_trigger" AS ENUM('before_appointment', 'appointment_day', 'after_appointment', 'after_purchase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_dispatches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"rule_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" bigint NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "automation_dispatch_status" DEFAULT 'processing' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"message" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"name" text NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"days_offset" integer DEFAULT 0 NOT NULL,
	"send_time" time DEFAULT '09:00' NOT NULL,
	"message_template" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation_dispatches" ADD CONSTRAINT "automation_dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation_dispatches" ADD CONSTRAINT "automation_dispatches_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation_dispatches" ADD CONSTRAINT "automation_dispatches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_dispatch_source_unique" ON "automation_dispatches" USING btree ("rule_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_dispatch_org_idx" ON "automation_dispatches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_org_idx" ON "automation_rules" USING btree ("organization_id","active");
