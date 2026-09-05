-- Instalações que já possuíam o enum antes da migration 0015 mantiveram a
-- versão antiga porque o bloco CREATE TYPE ignorou duplicate_object. Completa
-- o tipo de forma idempotente, sem tocar nas regras existentes.
ALTER TYPE "public"."automation_trigger" ADD VALUE IF NOT EXISTS 'before_appointment';--> statement-breakpoint
ALTER TYPE "public"."automation_trigger" ADD VALUE IF NOT EXISTS 'appointment_day';--> statement-breakpoint
ALTER TYPE "public"."automation_trigger" ADD VALUE IF NOT EXISTS 'after_appointment';--> statement-breakpoint
ALTER TYPE "public"."automation_trigger" ADD VALUE IF NOT EXISTS 'after_purchase';
