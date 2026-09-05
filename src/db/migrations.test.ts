import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O porteiro das migrations.
 *
 * As duas falhas que ele pega já aconteceram, com uma semana de diferença, e
 * nenhuma delas aparece em build, tipo ou lint. As duas só se manifestam no
 * deploy — e o `Dockerfile` roda `node scripts/migrate.mjs && exec node
 * server.js`, então migration que falha impede o contêiner de subir e o Coolify
 * rola de volta.
 *
 * FALHA 1 — ARQUIVO SEM ENTRADA NO DIÁRIO.
 * Uma migration escrita à mão (`0029_municipios_ibge.sql`) foi criada sem a
 * linha correspondente em `meta/_journal.json`. O `drizzle-kit migrate` roda o
 * DIÁRIO, não a pasta: o arquivo existia, ninguém reclamava, e a tabela
 * `municipios` simplesmente ficava vazia em produção — com a busca por cidade
 * devolvendo nada e nenhum erro em lugar nenhum.
 *
 * FALHA 2 — CARIMBO FORA DE ORDEM.
 * Duas sessões criaram uma `0028` no mesmo dia. Renumerar preserva o conteúdo e
 * o hash, mas o `drizzle-kit generate` que reconstrói a cadeia de snapshots
 * carimba um `when` NOVO. E o migrator do drizzle decide o que aplicar
 * comparando TIMESTAMP com o último registro de `__drizzle_migrations`, não
 * procurando o hash. Com carimbo mais novo que o do banco, ele reaplicou uma
 * migration já aplicada, o `CREATE TYPE` estourou com "type already exists" e o
 * deploy caiu.
 */

const PASTA = join(process.cwd(), "drizzle");

type Entrada = { idx: number; when: number; tag: string };

function diario(): Entrada[] {
  return JSON.parse(readFileSync(join(PASTA, "meta", "_journal.json"), "utf8")).entries;
}

function arquivosSql(): string[] {
  return readdirSync(PASTA)
    .filter((nome) => nome.endsWith(".sql"))
    .map((nome) => nome.replace(/\.sql$/, ""))
    .sort();
}

describe("migrations", () => {
  it("todo arquivo .sql tem entrada no diário, e vice-versa", () => {
    const noDiario = new Set(diario().map((e) => e.tag));
    const naPasta = new Set(arquivosSql());

    const orfaos = [...naPasta].filter((tag) => !noDiario.has(tag));
    expect(
      orfaos,
      "Estes .sql existem em drizzle/ mas NÃO estão em meta/_journal.json, " +
        "então `drizzle-kit migrate` nunca vai executá-los — e nada vai reclamar: " +
        orfaos.join(", "),
    ).toEqual([]);

    const fantasmas = [...noDiario].filter((tag) => !naPasta.has(tag));
    expect(
      fantasmas,
      "O diário aponta para arquivos que não existem: " + fantasmas.join(", "),
    ).toEqual([]);
  });

  it("os carimbos do diário são estritamente crescentes", () => {
    // O migrator aplica tudo que tem `when` maior que o último aplicado no
    // banco. Carimbo fora de ordem faz migration antiga ser reaplicada ou
    // migration nova ser pulada em silêncio.
    const entradas = diario();
    const foraDeOrdem: string[] = [];
    for (let i = 1; i < entradas.length; i += 1) {
      if (entradas[i].when <= entradas[i - 1].when) {
        foraDeOrdem.push(`${entradas[i].tag} (${entradas[i].when}) <= ${entradas[i - 1].tag} (${entradas[i - 1].when})`);
      }
    }
    expect(foraDeOrdem, "Carimbos fora de ordem em meta/_journal.json").toEqual([]);
  });

  it("o índice do diário acompanha a ordem dos arquivos", () => {
    const entradas = diario();
    entradas.forEach((entrada, i) => {
      expect(entrada.idx, `entrada ${entrada.tag}`).toBe(i);
    });
  });

  it("migration renumerada à mão é idempotente", () => {
    /**
     * Quem renumera precisa deixar o arquivo capaz de rodar duas vezes.
     *
     * O carimbo certo já evita a reexecução, mas ele depende de alguém lembrar,
     * e a próxima colisão de numeração entre sessões vai acontecer. A regra
     * vale só para os arquivos que JÁ foram renumerados — os gerados pelo
     * drizzle-kit em cadeia limpa não precisam.
     */
    const RENUMERADAS = ["0030_real_killmonger", "0031_municipios_ibge"];
    for (const tag of RENUMERADAS) {
      const sql = readFileSync(join(PASTA, `${tag}.sql`), "utf8");
      const instrucoes = sql
        .split("--> statement-breakpoint")
        .map((bloco) =>
          bloco
            .split("\n")
            .filter((linha) => !linha.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter(Boolean);

      for (const instrucao of instrucoes) {
        const primeira = instrucao.toUpperCase();
        const protegida =
          primeira.includes("IF NOT EXISTS") ||
          primeira.includes("ON CONFLICT") ||
          // CREATE TYPE não aceita IF NOT EXISTS em versão nenhuma do Postgres:
          // a forma segura é o bloco anônimo capturando duplicate_object.
          (primeira.startsWith("DO $$") && primeira.includes("DUPLICATE_OBJECT"));
        expect(
          protegida,
          `${tag}: instrução não sobrevive a uma segunda execução —\n${instrucao.slice(0, 120)}`,
        ).toBe(true);
      }
    }
  });
});
