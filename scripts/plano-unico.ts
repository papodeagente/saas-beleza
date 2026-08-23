import { eq, ne, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { plans } from "../src/db/schema";

/**
 * Migra o catálogo de três faixas para o plano único de R$ 97.
 *
 * Duas decisões que valem explicação:
 *
 * 1. Os planos antigos são DESATIVADOS, não apagados. `subscriptions.planId` é
 *    NOT NULL com chave estrangeira, então cada linha de plano é o único jeito
 *    de uma assinatura apontar para um preço. Apagar destruiria a capacidade de
 *    ter preço de exceção (fundador, negociado, promocional) e apagaria a
 *    fronteira entre coortes nos relatórios. Três linhas dormentes não custam
 *    nada; a opcionalidade custa caro.
 *
 * 2. O R$ 97 é uma LINHA NOVA, não uma edição do Essencial de R$ 149. A tabela
 *    `plans` guarda o preço atual, não o histórico. Reescrever o Essencial faria
 *    a coorte de R$ 149 e a de R$ 97 ficarem indistinguíveis para sempre, porque
 *    `subscription_events.plan_id_before/after` apontaria para a mesma linha.
 *
 * O nome é "Lumina", não "Único": nome de faixa só existe para se opor a outra
 * faixa. Com um plano só, o nome do plano é o nome do produto — e não vira
 * constrangimento no dia em que existir um segundo.
 */

const SLUG = "lumina";

/** O que o cartão de preço lista. Cada linha tem código que a sustenta. */
const BENEFICIOS = [
  "Agenda por profissional, por unidade e por sala",
  "Link público de agendamento com o nome da sua clínica",
  "Inbox de WhatsApp com fila, transferência e transcrição de áudio",
  "Agente de IA com base de conhecimento e permissão por ação",
  "Ficha da cliente com histórico, faltas e retorno",
  "Financeiro do mês, receita por serviço e comissão por profissional",
  "Catálogo com duração, preço, custo e margem",
  "Caixa de entrada dos grupos de WhatsApp",
  "Acessos separados para proprietária, recepção e profissional",
  "Suporte por WhatsApp com quem faz o produto",
];

async function main() {
  // --- 1. Aposenta o catálogo antigo -------------------------------------
  const antigos = await db
    .select({ id: plans.id, name: plans.name, slug: plans.slug, description: plans.description })
    .from(plans)
    .where(ne(plans.slug, SLUG));

  for (const p of antigos) {
    const nota = "Descontinuado em ago/2026, substituído pelo plano único.";
    await db
      .update(plans)
      .set({
        active: false,
        publicVisible: false,
        description: p.description?.startsWith(nota) ? p.description : `${nota} ${p.description ?? ""}`.trim(),
        updatedAt: new Date(),
      })
      .where(eq(plans.id, p.id));
    console.log(`  aposentado: ${p.name} (${p.slug})`);
  }

  // --- 2. Cria o plano único ---------------------------------------------
  // `yearlyPriceCents` é o ANO INTEIRO: 10 mensalidades, ou seja 2 meses de
  // graça. É a convenção que dono de clínica calcula de cabeça.
  const valores = {
    name: "Lumina",
    description: "Tudo que a clínica precisa, sem cobrança por usuário.",
    tagline: "A clínica inteira por um preço só",
    monthlyPriceCents: 9_700,
    yearlyPriceCents: 97_000,
    trialDays: 14,
    maxBranches: null,
    maxProfessionals: null,
    maxUsers: null,
    features: BENEFICIOS,
    active: true,
    publicVisible: true,
    highlight: false,
    highlightLabel: null,
    // Sem link de checkout ainda: o botão cai no teste grátis até a Hotmart
    // ser ligada. É isso que impede a página de exibir um botão morto.
    ctaLabel: null,
    checkoutUrlMonthly: null,
    checkoutUrlYearly: null,
    position: 1,
  };

  const [plano] = await db
    .insert(plans)
    .values({ slug: SLUG, ...valores })
    .onConflictDoUpdate({ target: plans.slug, set: { ...valores, updatedAt: new Date() } })
    .returning({ id: plans.id, name: plans.name });

  console.log(`\n  plano ativo: ${plano.name} (id ${plano.id})`);

  // --- 3. Confere ---------------------------------------------------------
  const { rows } = await db.execute<{
    slug: string;
    name: string;
    active: boolean;
    publico: boolean;
    mensal: number;
    anual: number;
    beneficios: number;
  }>(sql`
    select slug, name, active, public_visible as publico,
           monthly_price_cents as mensal, yearly_price_cents as anual,
           coalesce(jsonb_array_length(features), 0) as beneficios
    from plans order by active desc, position, id
  `);

  console.log("\nCatálogo agora:");
  for (const r of rows as Array<Record<string, unknown>>) {
    const estado = r.active ? (r.publico ? "à venda e no site" : "à venda, fora do site") : "aposentado";
    console.log(
      `  ${String(r.name).padEnd(14)} ${estado.padEnd(24)} ` +
        `R$ ${(Number(r.mensal) / 100).toFixed(2)}/mês · R$ ${(Number(r.anual) / 100).toFixed(2)}/ano · ${r.beneficios} benefícios`,
    );
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    pool.end();
    process.exit(1);
  });
