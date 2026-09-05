CREATE TABLE "whatsapp_profile_pictures" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"jid" text NOT NULL,
	"mime" text,
	"data_base64" text,
	"missing" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_profile_pictures" ADD CONSTRAINT "whatsapp_profile_pictures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_profile_pictures_unique" ON "whatsapp_profile_pictures" USING btree ("organization_id","jid");