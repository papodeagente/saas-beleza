CREATE TYPE "public"."geo_precision" AS ENUM('exata', 'rua', 'bairro', 'cidade', 'nenhuma');--> statement-breakpoint
CREATE TYPE "public"."geo_source" AS ENUM('manual', 'cep', 'municipio', 'pino');--> statement-breakpoint
CREATE TABLE "municipios" (
	"ibge_code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"uf" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"capital" boolean DEFAULT false NOT NULL,
	"ddd" integer,
	"timezone" text NOT NULL,
	"search_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "complement" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "ibge_code" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geo_source" "geo_source";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geo_precision" "geo_precision";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "marketplace_listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "marketplace_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "marketplace_bio" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "marketplace_whatsapp" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "marketplace_instagram" text;--> statement-breakpoint
CREATE INDEX "municipios_uf_name_idx" ON "municipios" USING btree ("uf","name");--> statement-breakpoint
CREATE INDEX "municipios_search_idx" ON "municipios" USING btree ("search_key");--> statement-breakpoint
CREATE INDEX "municipios_geo_idx" ON "municipios" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "branches_cidade_idx" ON "branches" USING btree ("uf","city");--> statement-breakpoint
CREATE INDEX "branches_ibge_idx" ON "branches" USING btree ("ibge_code");--> statement-breakpoint
CREATE INDEX "branches_geo_idx" ON "branches" USING btree ("lat","lng");