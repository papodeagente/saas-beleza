import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";

/**
 * Remove do painel da plataforma tudo que foi inventado para demonstração.
 *
 * Um painel de negócio com número fabricado é pior que um painel vazio: o vazio
 * se corrige sozinho quando o primeiro cliente entra, o número falso vira
 * decisão errada. Este script devolve a verdade.
 *
 * O que sai:
 *  - as clínicas de demonstração (slug `demo-%`) e tudo que pende delas
 *  - as assinaturas e os eventos de MRR, que nunca corresponderam a um contrato
 *
 * O que FICA:
 *  - a Clínica Lumina como organização, porque é o login e a demonstração do
 *    produto em si (agenda, clientes, atendimentos)
 *  - os planos, o acesso de plataforma e o provedor de pagamento
 *
 * Nenhuma tabela tem ON DELETE CASCADE para organizations, e são mais de trinta
 * apontando para lá. Em vez de fixar a ordem das dependências à mão — que
 * envelhece mal a cada tabela nova — o script tenta apagar todas e repete
 * enquanto houver progresso: as folhas saem primeiro, e as dependentes liberam
 * as demais a cada passada.
 */

async function tabelasComOrganizationId(): Promise<string[]> {
  const { rows } = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'organization_id'
      and table_name <> 'organizations'
    order by table_name
  `);
  return (rows as { table_name: string }[]).map((r) => r.table_name);
}

async function apagarEmCascataManual(orgIds: number[]) {
  const ids = sql.join(
    orgIds.map((id) => sql`${id}`),
    sql`, `,
  );

  let pendentes = await tabelasComOrganizationId();

  while (pendentes.length > 0) {
    const falharam: string[] = [];

    for (const tabela of pendentes) {
      try {
        await db.execute(
          sql`delete from ${sql.identifier(tabela)} where organization_id in (${ids})`,
        );
      } catch (error) {
        // Violação de chave estrangeira: alguma tabela ainda aponta para esta.
        // Guarda para a próxima passada, quando a dependente já terá saído.
        if ((error as { code?: string }).code === "23503") falharam.push(tabela);
        else throw error;
      }
    }

    if (falharam.length === pendentes.length) {
      throw new Error(
        `Ciclo de dependências impede a remoção: ${falharam.join(", ")}. ` +
          "Apague manualmente ou ajuste a ordem.",
      );
    }
    pendentes = falharam;
  }

  await db.execute(sql`delete from organizations where id in (${ids})`);
}

async function main() {
  const { rows: demoRows } = await db.execute<{ id: number; name: string }>(sql`
    select id, name from organizations where slug like 'demo-%' order by id
  `);
  const demo = demoRows as { id: number; name: string }[];

  if (demo.length > 0) {
    await apagarEmCascataManual(demo.map((o) => o.id));
    console.log(`Contas de demonstração removidas: ${demo.length}`);
    for (const o of demo) console.log(`  - ${o.name}`);
  } else {
    console.log("Nenhuma conta de demonstração encontrada.");
  }

  // As assinaturas restantes também foram inventadas: nenhuma clínica contratou.
  const { rows: assinaturaRows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from subscriptions`,
  );
  const restantes = (assinaturaRows as { n: number }[])[0].n;
  if (restantes > 0) {
    await db.execute(sql`delete from platform_charges`);
    await db.execute(sql`delete from subscription_events`);
    await db.execute(sql`delete from subscriptions`);
    console.log(`\nAssinaturas fabricadas removidas: ${restantes}`);
  }

  const { rows: resumoRows } = await db.execute<{
    contas: number;
    assinaturas: number;
    eventos: number;
    planos: number;
    admins: number;
  }>(sql`
    select
      (select count(*) from organizations)::int as contas,
      (select count(*) from subscriptions)::int as assinaturas,
      (select count(*) from subscription_events)::int as eventos,
      (select count(*) from plans)::int as planos,
      (select count(*) from platform_admins)::int as admins
  `);
  const resumo = (resumoRows as Array<Record<string, number>>)[0];

  console.log("\nEstado real do painel agora:");
  console.log(`  organizações .... ${resumo.contas}`);
  console.log(`  assinaturas ..... ${resumo.assinaturas}`);
  console.log(`  eventos de MRR .. ${resumo.eventos}`);
  console.log(`  MRR ............. R$ 0,00`);
  console.log(`  planos .......... ${resumo.planos} (mantidos)`);
  console.log(`  administradores . ${resumo.admins} (mantidos)`);
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });
