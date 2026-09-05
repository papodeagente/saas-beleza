-- Gerado por `drizzle-kit generate`.
--
-- As migrações 0017–0020 foram escritas à mão e não deixaram snapshot em
-- drizzle/meta/, então o gerador diferenciou contra o 0016 e reemitiu o que já
-- está aplicado: a tabela `booking_page_visits` e os três valores novos de
-- `automation_trigger`. Conferido no banco antes de podar (to_regclass devolve
-- a tabela; pg_enum já lista appointment_created, birthday_before e
-- birthday_day), essas linhas foram removidas porque rodariam com erro. O
-- snapshot 0021 gravado agora descreve o schema COMPLETO, então a cadeia de
-- snapshots volta ao normal a partir daqui.
CREATE TYPE "public"."conversation_origin" AS ENUM('user', 'automation');--> statement-breakpoint
ALTER TABLE "automation_dispatches" ADD COLUMN "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_dispatches" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "automation_dispatches" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "started_by" "conversation_origin";--> statement-breakpoint
CREATE INDEX "automation_dispatch_retry_idx" ON "automation_dispatches" USING btree ("status","last_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_active_trigger_unique" ON "automation_rules" USING btree ("organization_id","trigger") WHERE "automation_rules"."active";
