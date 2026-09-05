CREATE TYPE "public"."scheduled_message_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "scheduled_group_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"group_jid" text NOT NULL,
	"group_name" text,
	"body" text DEFAULT '' NOT NULL,
	"media_kind" "wa_message_type",
	"media_data" text,
	"media_file_name" text,
	"mention_all" boolean DEFAULT false NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "scheduled_message_status" DEFAULT 'pending' NOT NULL,
	"created_by_user_id" bigint,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_group_messages" ADD CONSTRAINT "scheduled_group_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_group_messages" ADD CONSTRAINT "scheduled_group_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_group_org_idx" ON "scheduled_group_messages" USING btree ("organization_id","group_jid","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_group_due_idx" ON "scheduled_group_messages" USING btree ("status","scheduled_for");