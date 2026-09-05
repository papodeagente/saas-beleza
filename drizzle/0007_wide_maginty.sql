CREATE TYPE "public"."wa_group_classification" AS ENUM('none', 'radar', 'opportunity', 'private');--> statement-breakpoint
CREATE TABLE "whatsapp_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"connection_id" bigint,
	"jid" text NOT NULL,
	"name" text,
	"description" text,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"classification" "wa_group_classification" DEFAULT 'none' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_summary" text,
	"last_summary_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_groups_org_jid_unique" ON "whatsapp_groups" USING btree ("organization_id","jid");--> statement-breakpoint
CREATE INDEX "wa_groups_org_classification_idx" ON "whatsapp_groups" USING btree ("organization_id","classification");