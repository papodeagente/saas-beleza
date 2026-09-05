CREATE TABLE "booking_page_visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"visitor_token" text NOT NULL,
	"visit_date" date NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "booking_page_visits" ADD CONSTRAINT "booking_page_visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_visits_daily_unique" ON "booking_page_visits" USING btree ("organization_id","visitor_token","visit_date");--> statement-breakpoint
CREATE INDEX "booking_visits_org_date_idx" ON "booking_page_visits" USING btree ("organization_id","visit_date");
