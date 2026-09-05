-- Migração de DADOS (drizzle-kit generate --custom). Duas correções de dados
-- que o schema sozinho não faz.

-- (1) Toda conversa que já tinha autor humano passa a declarar a origem. Sem
-- isto o teto de vazão deixaria de enxergar o histórico no instante em que
-- passasse a contar por `started_by`, e a conta ganharia uma hora de folga
-- justamente na virada.
UPDATE "conversations"
SET "started_by" = 'user'
WHERE "started_by" IS NULL AND "started_by_user_id" IS NOT NULL;
--> statement-breakpoint

-- (2) A chave de deduplicação dos lembretes de agenda passa a ser a OCORRÊNCIA
-- (agendamento + dia), não o agendamento. Sem reescrever o que já existe, todo
-- lembrete já enviado deixaria de casar com a chave nova e a cliente receberia
-- a MESMA mensagem de novo — exatamente o defeito que a mudança combate.
--
-- A data é reconstruída a partir de `scheduled_for`, e não da data atual do
-- agendamento: `scheduled_for` é o instante que foi calculado no envio, então
-- devolve a chave como ela teria sido escrita naquele momento mesmo se o
-- horário tiver sido remarcado depois. Conferido antes de aplicar — para as 4
-- linhas existentes o valor calculado bate com a data real do agendamento.
UPDATE "automation_dispatches" d
SET "source_type" = 'appointment:' || to_char(
  ((d."scheduled_for" AT TIME ZONE o."timezone")::date + r."days_offset"),
  'YYYY-MM-DD'
)
FROM "automation_rules" r, "organizations" o
WHERE r."id" = d."rule_id"
  AND o."id" = d."organization_id"
  AND r."trigger" IN ('before_appointment', 'appointment_day')
  AND d."source_type" = 'appointment';
