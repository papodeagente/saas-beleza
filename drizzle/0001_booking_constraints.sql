-- Autoridade final anti-double-booking: o banco rejeita sobreposição de horário
-- para o mesmo profissional (e para o mesmo recurso) em status ativos,
-- imune a race conditions entre requests concorrentes.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_professional_overlap"
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('scheduled', 'confirmed', 'checked_in', 'in_progress'));
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_resource_overlap"
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (resource_id IS NOT NULL AND status IN ('scheduled', 'confirmed', 'checked_in', 'in_progress'));
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_valid_range" CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_valid_range" CHECK (ends_at > starts_at);
