-- Rede de segurança para o código da conta.
--
-- A aplicação já é obrigada a gerar o código: a coluna é NOT NULL sem default no
-- schema do Drizzle, então o compilador recusa qualquer INSERT que a esqueça.
-- O que essa garantia não alcança é o INSERT feito fora da aplicação — um
-- `insert into organizations` no psql durante um socorro, uma restauração
-- parcial, uma migração de dados escrita à mão.
--
-- O default cobre esse caso e nada mais: quem passa pelo código continua
-- mandando o valor gerado em src/lib/account-code.ts, com o alfabeto inteiro.
-- Aqui o alfabeto é o hexadecimal, subconjunto do outro, então o resultado é
-- indistinguível de um código legítimo.
ALTER TABLE "organizations"
  ALTER COLUMN "public_id" SET DEFAULT (
    upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
    || '-'
    || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4))
  );
