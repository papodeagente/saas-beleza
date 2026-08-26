import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  auditLogs,
  products,
  professionalServices,
  professionals,
  resources,
  serviceCategories,
  services,
} from "@/db/schema";
import type { TenantContext } from "@/server/auth";

/**
 * Catálogo: serviços e produtos.
 *
 * A lógica morava solta dentro do `actions.ts` da tela e só sabia CRIAR. Veio
 * para cá pelo mesmo motivo do `customer-service`: é aqui que dá para provar
 * com teste que uma clínica não edita o catálogo da outra.
 *
 * A GUARDA MULTI-TENANT É O PRÓPRIO `where`: todo update casa `id` E
 * `organizationId`, e a ausência de linha devolvida é o que denuncia a
 * tentativa. Verificar antes com um `select` seria uma segunda verdade, e a
 * segunda verdade é a que sai de sincronia.
 */

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * O rastro da mudança.
 *
 * `audit_logs` existe desde a primeira migração e nunca ninguém escreveu nela.
 * Começa aqui porque é aqui que dinheiro muda de valor: preço, custo e comissão
 * são editáveis a partir de agora, e "quem baixou o preço na sexta à noite" é a
 * pergunta que aparece depois, quando já não dá para responder.
 *
 * Grava só o que MUDOU. Um registro com o objeto inteiro a cada salvamento é um
 * diário que ninguém lê; um com três campos é uma resposta.
 */
async function registrar(
  tx: Tx,
  ctx: TenantContext,
  entidade: "service" | "product",
  entidadeId: number,
  acao: string,
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown>,
): Promise<void> {
  const mudou = antes
    ? Object.keys(depois).filter((chave) => !Object.is(antes[chave], depois[chave]))
    : Object.keys(depois);
  if (mudou.length === 0) return;
  await tx.insert(auditLogs).values({
    organizationId: ctx.organizationId,
    actorType: "user",
    actorId: ctx.userId,
    entity: entidade,
    entityId: entidadeId,
    action: acao,
    before: antes ? Object.fromEntries(mudou.map((c) => [c, antes[c]])) : null,
    after: Object.fromEntries(mudou.map((c) => [c, depois[c]])),
  });
}

export type ServiceInput = {
  name: string;
  categoryName: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  costCents: number;
  commissionPct: number | null;
  returnIntervalDays: number | null;
  requiredResourceType: "room" | "cabin" | "equipment" | null;
  onlineBooking: boolean;
  professionalIds: number[];
};

export type ProductInput = {
  name: string;
  categoryName: string;
  description: string | null;
  sku: string | null;
  priceCents: number;
  costCents: number;
  stockQty: number;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A categoria é digitada, não escolhida numa lista: quem cadastra um serviço
 * está pensando no serviço, não em taxonomia. Existente ganha o vínculo,
 * inexistente nasce — e a comparação é sem diferenciar maiúsculas, senão
 * "Unhas em gel" e "unhas em gel" viram duas gavetas com o mesmo nome.
 */
async function categoryIdFor(
  tx: Tx,
  organizationId: number,
  categoryName: string,
): Promise<number | null> {
  const name = categoryName.trim();
  if (!name) return null;
  const [existing] = await tx
    .select({ id: serviceCategories.id })
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.organizationId, organizationId),
        sql`lower(${serviceCategories.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(serviceCategories)
    .values({ organizationId, name })
    .returning({ id: serviceCategories.id });
  return created.id;
}

/**
 * As mesmas travas valem para criar e para editar.
 *
 * Não é simetria de gosto: o serviço que fica sem profissional habilitado
 * DEPOIS de editado some da agenda online sem avisar ninguém, e o que passa a
 * exigir uma cabine que não existe deixa de ter horário — os dois defeitos
 * aparecem só quando a cliente tenta marcar.
 */
async function validarServico(
  organizationId: number,
  input: ServiceInput,
): Promise<number[]> {
  const pedidos = [...new Set(input.professionalIds)];
  const habilitados = pedidos.length
    ? await db
        .select({ id: professionals.id })
        .from(professionals)
        .where(
          and(
            eq(professionals.organizationId, organizationId),
            inArray(professionals.id, pedidos),
          ),
        )
    : [];

  if (habilitados.length !== pedidos.length) {
    throw new CatalogError(
      "Um dos profissionais selecionados é inválido.",
      "PROFISSIONAL_INVALIDO",
      "professionalIds",
    );
  }

  if (input.onlineBooking && habilitados.length === 0) {
    throw new CatalogError(
      "Escolha pelo menos um profissional para disponibilizar este serviço na agenda online.",
      "SEM_PROFISSIONAL",
      "professionalIds",
    );
  }

  if (input.requiredResourceType) {
    const [existe] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.type, input.requiredResourceType),
          eq(resources.active, true),
        ),
      )
      .limit(1);
    if (!existe) {
      const rotulo = { room: "sala", cabin: "cabine", equipment: "equipamento" }[
        input.requiredResourceType
      ];
      throw new CatalogError(
        `Cadastre ao menos um recurso ativo do tipo ${rotulo} em Gestão ou selecione “Nenhum”.`,
        "SEM_RECURSO",
        "requiredResourceType",
      );
    }
  }

  return habilitados.map((p) => p.id);
}

/** Campos que saem do formulário direto para a tabela, iguais em criar e editar. */
function camposDoServico(input: ServiceInput, categoryId: number | null) {
  return {
    categoryId,
    name: input.name.trim(),
    description: input.description,
    durationMin: input.durationMin,
    priceCents: input.priceCents,
    costCents: input.costCents,
    commissionBps: input.commissionPct === null ? null : Math.round(input.commissionPct * 100),
    returnIntervalDays: input.returnIntervalDays,
    requiredResourceType: input.requiredResourceType,
    onlineBooking: input.onlineBooking,
  };
}

export async function createService(ctx: TenantContext, input: ServiceInput): Promise<number> {
  const habilitados = await validarServico(ctx.organizationId, input);
  return db.transaction(async (tx) => {
    const categoryId = await categoryIdFor(tx, ctx.organizationId, input.categoryName);
    const [service] = await tx
      .insert(services)
      .values({ organizationId: ctx.organizationId, ...camposDoServico(input, categoryId) })
      .returning({ id: services.id });
    if (habilitados.length) {
      await tx.insert(professionalServices).values(
        habilitados.map((professionalId) => ({
          organizationId: ctx.organizationId,
          professionalId,
          serviceId: service.id,
        })),
      );
    }
    await registrar(tx, ctx, "service", service.id, "created", null, {
      ...camposDoServico(input, categoryId),
      professionalIds: habilitados.join(","),
    });
    return service.id;
  });
}

export async function updateService(
  ctx: TenantContext,
  serviceId: number,
  input: ServiceInput,
): Promise<number> {
  const habilitados = await validarServico(ctx.organizationId, input);
  return db.transaction(async (tx) => {
    const categoryId = await categoryIdFor(tx, ctx.organizationId, input.categoryName);
    // O estado anterior serve ao rastro, NÃO à guarda de tenant: quem guarda é
    // o `where` do update, logo abaixo.
    const [servicoAntes] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.organizationId, ctx.organizationId)))
      .limit(1);
    const [atualizado] = await tx
      .update(services)
      .set(camposDoServico(input, categoryId))
      .where(and(eq(services.id, serviceId), eq(services.organizationId, ctx.organizationId)))
      .returning({ id: services.id });
    if (!atualizado) throw new CatalogError("Serviço não encontrado.", "NAO_ENCONTRADO");

    /**
     * O vínculo com profissionais é gravado POR DIFERENÇA — apaga só quem saiu,
     * insere só quem entrou, e não encosta em quem ficou.
     *
     * Apagar tudo e reinserir a seleção daria o mesmo resultado na tela e
     * levaria junto o `commission_bps` da própria linha: o override de comissão
     * por profissional × serviço, que é o PRIMEIRO da precedência quando o
     * atendimento é fechado. Hoje nada preenche essa coluna, então o prejuízo
     * seria invisível — e apareceria meses depois, no bolso de alguém, no dia
     * em que a clínica começasse a usar comissão por profissional.
     */
    const atuais = await tx
      .select({ professionalId: professionalServices.professionalId })
      .from(professionalServices)
      .where(
        and(
          eq(professionalServices.organizationId, ctx.organizationId),
          eq(professionalServices.serviceId, serviceId),
        ),
      );
    const antes = new Set(atuais.map((linha) => linha.professionalId));
    const depois = new Set(habilitados);
    const sairam = [...antes].filter((id) => !depois.has(id));
    const entraram = [...depois].filter((id) => !antes.has(id));

    if (sairam.length) {
      await tx
        .delete(professionalServices)
        .where(
          and(
            eq(professionalServices.organizationId, ctx.organizationId),
            eq(professionalServices.serviceId, serviceId),
            inArray(professionalServices.professionalId, sairam),
          ),
        );
    }
    if (entraram.length) {
      await tx.insert(professionalServices).values(
        entraram.map((professionalId) => ({
          organizationId: ctx.organizationId,
          professionalId,
          serviceId,
        })),
      );
    }

    await registrar(
      tx,
      ctx,
      "service",
      serviceId,
      "updated",
      servicoAntes
        ? {
            categoryId: servicoAntes.categoryId,
            name: servicoAntes.name,
            description: servicoAntes.description,
            durationMin: servicoAntes.durationMin,
            priceCents: servicoAntes.priceCents,
            costCents: servicoAntes.costCents,
            commissionBps: servicoAntes.commissionBps,
            returnIntervalDays: servicoAntes.returnIntervalDays,
            requiredResourceType: servicoAntes.requiredResourceType,
            onlineBooking: servicoAntes.onlineBooking,
            professionalIds: [...antes].sort().join(","),
          }
        : null,
      { ...camposDoServico(input, categoryId), professionalIds: [...depois].sort().join(",") },
    );
    return atualizado.id;
  });
}

export async function createProduct(ctx: TenantContext, input: ProductInput): Promise<number> {
  return db.transaction(async (tx) => {
    const categoryId = await categoryIdFor(tx, ctx.organizationId, input.categoryName);
    const [created] = await tx
      .insert(products)
      .values({
        organizationId: ctx.organizationId,
        categoryId,
        name: input.name.trim(),
        description: input.description,
        sku: input.sku,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stockQty: input.stockQty,
      })
      .returning({ id: products.id });
    await registrar(tx, ctx, "product", created.id, "created", null, {
      categoryId,
      name: input.name.trim(),
      description: input.description,
      sku: input.sku,
      priceCents: input.priceCents,
      costCents: input.costCents,
      stockQty: input.stockQty,
    });
    return created.id;
  });
}

export async function updateProduct(
  ctx: TenantContext,
  productId: number,
  input: ProductInput,
): Promise<number> {
  return db.transaction(async (tx) => {
    const categoryId = await categoryIdFor(tx, ctx.organizationId, input.categoryName);
    const [produtoAntes] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)))
      .limit(1);
    const [atualizado] = await tx
      .update(products)
      .set({
        categoryId,
        name: input.name.trim(),
        description: input.description,
        sku: input.sku,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stockQty: input.stockQty,
      })
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)))
      .returning({ id: products.id });
    if (!atualizado) throw new CatalogError("Produto não encontrado.", "NAO_ENCONTRADO");
    await registrar(
      tx,
      ctx,
      "product",
      productId,
      "updated",
      produtoAntes
        ? {
            categoryId: produtoAntes.categoryId,
            name: produtoAntes.name,
            description: produtoAntes.description,
            sku: produtoAntes.sku,
            priceCents: produtoAntes.priceCents,
            costCents: produtoAntes.costCents,
            stockQty: produtoAntes.stockQty,
          }
        : null,
      {
        categoryId,
        name: input.name.trim(),
        description: input.description,
        sku: input.sku,
        priceCents: input.priceCents,
        costCents: input.costCents,
        stockQty: input.stockQty,
      },
    );
    return atualizado.id;
  });
}

/**
 * Desativar existe porque APAGAR não pode existir.
 *
 * `appointments.service_id` é chave estrangeira: apagar um serviço com
 * atendimento marcado, ou já concluído, ou o banco recusa ou leva o histórico
 * junto. Inativo some da agenda e do agendamento online, e o que já aconteceu
 * continua tendo nome.
 */
export async function setServiceActive(
  ctx: TenantContext,
  serviceId: number,
  active: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [atualizado] = await tx
      .update(services)
      .set({ active })
      .where(and(eq(services.id, serviceId), eq(services.organizationId, ctx.organizationId)))
      .returning({ id: services.id });
    if (!atualizado) throw new CatalogError("Serviço não encontrado.", "NAO_ENCONTRADO");
    await registrar(tx, ctx, "service", serviceId, active ? "activated" : "deactivated", null, {
      active,
    });
  });
}

export async function setProductActive(
  ctx: TenantContext,
  productId: number,
  active: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [atualizado] = await tx
      .update(products)
      .set({ active })
      .where(and(eq(products.id, productId), eq(products.organizationId, ctx.organizationId)))
      .returning({ id: products.id });
    if (!atualizado) throw new CatalogError("Produto não encontrado.", "NAO_ENCONTRADO");
    await registrar(tx, ctx, "product", productId, active ? "activated" : "deactivated", null, {
      active,
    });
  });
}

/**
 * Quantos atendimentos futuros dependem deste serviço.
 *
 * É o que a tela precisa saber ANTES de desativar: o serviço sai da agenda,
 * mas quem já está marcado continua marcado, e a dona tem de decidir sabendo
 * disso.
 */
export async function futurosDoServico(ctx: TenantContext, serviceId: number): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, ctx.organizationId),
        eq(appointments.serviceId, serviceId),
        gt(appointments.startsAt, new Date()),
        sql`${appointments.status} in ('scheduled','confirmed','checked_in','in_progress')`,
      ),
    );
  return linha?.total ?? 0;
}
