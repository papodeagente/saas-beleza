-- Geografia: municípios, endereço estruturado e opt-in do marketplace.
--
-- ESTE ARQUIVO É IDEMPOTENTE DE PROPÓSITO, e a razão é uma cicatriz.
--
-- Ele nasceu como `0028` e foi renumerado para `0030` quando duas sessões
-- criaram uma migration `0028` no mesmo dia. Renumerar preserva o conteúdo — e
-- portanto o hash — mas o `drizzle-kit generate` que reconstruiu a cadeia de
-- snapshots carimbou um `when` NOVO no diário. E o migrator do drizzle decide o
-- que aplicar comparando TIMESTAMP com o último registro de
-- `__drizzle_migrations`, não procurando o hash: com um carimbo mais novo que o
-- do banco, ele reaplicou tudo. O `CREATE TYPE` explodiu com "type already
-- exists", o `scripts/migrate.mjs` fez `process.exit(1)`, o contêiner nunca
-- subiu e o Coolify rolou de volta.
--
-- A trava dupla: os carimbos do diário voltaram a bater com o que está gravado
-- no banco (então nada é reaplicado aqui), E cada instrução abaixo aguenta
-- rodar de novo. A segunda existe porque a primeira depende de alguém lembrar —
-- e colisão de numeração entre sessões vai acontecer outra vez.
--
-- `DO $$ ... EXCEPTION WHEN duplicate_object` porque CREATE TYPE não aceita
-- IF NOT EXISTS em nenhuma versão do Postgres.

DO $$ BEGIN
  CREATE TYPE "public"."geo_precision" AS ENUM('exata', 'rua', 'bairro', 'cidade', 'nenhuma');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."geo_source" AS ENUM('manual', 'cep', 'municipio', 'pino');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "municipios" (
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
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "postal_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "street" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "number" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "complement" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "district" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "city" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "uf" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "ibge_code" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "lat" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "lng" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "geo_source" "geo_source";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "geo_precision" "geo_precision";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "marketplace_listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "marketplace_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "marketplace_bio" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "marketplace_whatsapp" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "marketplace_instagram" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "municipios_uf_name_idx" ON "municipios" USING btree ("uf","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "municipios_search_idx" ON "municipios" USING btree ("search_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "municipios_geo_idx" ON "municipios" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branches_cidade_idx" ON "branches" USING btree ("uf","city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branches_ibge_idx" ON "branches" USING btree ("ibge_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branches_geo_idx" ON "branches" USING btree ("lat","lng");
