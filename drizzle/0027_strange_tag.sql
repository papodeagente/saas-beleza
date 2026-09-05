CREATE TABLE "whatsapp_identities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"jid" text NOT NULL,
	"phone" text,
	"name" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_identities" ADD CONSTRAINT "whatsapp_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_identities_org_jid_unique" ON "whatsapp_identities" USING btree ("organization_id","jid");--> statement-breakpoint
CREATE INDEX "wa_identities_org_phone_idx" ON "whatsapp_identities" USING btree ("organization_id","phone");