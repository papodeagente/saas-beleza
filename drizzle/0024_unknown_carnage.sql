-- Código público da conta.
--
-- Em três passos de propósito: `ADD COLUMN NOT NULL` sem default falha numa
-- tabela que já tem linhas, e este banco já tem clínicas em uso. Então a coluna
-- nasce aceitando nulo, as linhas existentes são preenchidas, e só aí a
-- obrigatoriedade e a unicidade são impostas.
--
-- O preenchimento usa hexadecimal em maiúsculas: todos os seus caracteres
-- (0-9, A-F) pertencem ao alfabeto do código, então o resultado é indistinguível
-- de um código gerado pela aplicação. Contas novas usam o gerador em
-- src/lib/account-code.ts, com o alfabeto inteiro.
ALTER TABLE "organizations" ADD COLUMN "public_id" text;--> statement-breakpoint

UPDATE "organizations"
SET "public_id" = upper(substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 4))
  || '-'
  || upper(substr(md5(random()::text || id::text || clock_timestamp()::text), 5, 4))
WHERE "public_id" IS NULL;--> statement-breakpoint

ALTER TABLE "organizations" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_public_id_unique" UNIQUE("public_id");
