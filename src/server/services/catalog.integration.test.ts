import { randomBytes } from "node:crypto";
import { generateAccountCode } from "@/lib/account-code";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import {
  CatalogError,
  createProduct,
  createService,
  futurosDoServico,
  setServiceActive,
  updateProduct,
  updateService,
} from "./catalog-service";

/**
 * Editar catálogo.
 *
 * O que está protegido aqui é o conjunto de erros que não aparecem na tela: a
 * clínica que edita o serviço da vizinha, o vínculo de profissional apagado
 * junto com o override de comissão, e a trava do agendamento online que existe
 * na criação e podia faltar na edição — deixando um serviço publicado que nunca
 * terá horário.
 */

const SUFIXO = `vitest-catalogo-${randomBytes(4).toString("hex")}`;
let orgA = 0;
let orgB = 0;
let proA1 = 0;
let proA2 = 0;
let filialA = 0;
let clienteA = 0;
const ctx = (organizationId: number): TenantContext =>
  ({ organizationId, userId: 1, role: "admin" }) as TenantContext;

const servicoBase = {
  name: "Esmaltação em gel",
  categoryName: "Unhas",
  description: null,
  durationMin: 60,
  priceCents: 8000,
  costCents: 1500,
  commissionPct: null,
  returnIntervalDays: null,
  requiredResourceType: null,
  onlineBooking: false,
  professionalIds: [] as number[],
};

beforeAll(async () => {
  const criarOrg = async (nome: string) => {
    const [row] = await db
      .insert(s.organizations)
      .values({ publicId: generateAccountCode(), name: nome, slug: `${nome}-${SUFIXO}` })
      .returning({ id: s.organizations.id });
    return row.id;
  };
  orgA = await criarOrg("a");
  orgB = await criarOrg("b");

  const [filial] = await db
    .insert(s.branches)
    .values({ organizationId: orgA, name: `Unidade ${SUFIXO}` })
    .returning({ id: s.branches.id });
  filialA = filial.id;

  const criarPro = async (nome: string) => {
    const [row] = await db
      .insert(s.professionals)
      .values({ organizationId: orgA, name: nome })
      .returning({ id: s.professionals.id });
    return row.id;
  };
  proA1 = await criarPro(`Paula ${SUFIXO}`);
  proA2 = await criarPro(`Rita ${SUFIXO}`);

  const [cliente] = await db
    .insert(s.customers)
    .values({ organizationId: orgA, name: `Cliente ${SUFIXO}` })
    .returning({ id: s.customers.id });
  clienteA = cliente.id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await db.delete(s.auditLogs).where(eq(s.auditLogs.organizationId, id));
    await db.delete(s.appointments).where(eq(s.appointments.organizationId, id));
    await db.delete(s.professionalServices).where(eq(s.professionalServices.organizationId, id));
    await db.delete(s.services).where(eq(s.services.organizationId, id));
    await db.delete(s.products).where(eq(s.products.organizationId, id));
    await db.delete(s.serviceCategories).where(eq(s.serviceCategories.organizationId, id));
    await db.delete(s.customers).where(eq(s.customers.organizationId, id));
    await db.delete(s.professionals).where(eq(s.professionals.organizationId, id));
    await db.delete(s.branches).where(eq(s.branches.organizationId, id));
  }
  await db.delete(s.organizations).where(like(s.organizations.slug, `%-${SUFIXO}`));
  await pool.end();
});

describe("editar serviço", () => {
  it("salva o que foi mudado e não inventa o resto", async () => {
    const id = await createService(ctx(orgA), servicoBase);
    await updateService(ctx(orgA), id, {
      ...servicoBase,
      name: "Esmaltação em gel — mão e pé",
      priceCents: 12000,
      durationMin: 90,
    });
    const [depois] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(depois.name).toBe("Esmaltação em gel — mão e pé");
    expect(depois.priceCents).toBe(12000);
    expect(depois.durationMin).toBe(90);
    expect(depois.costCents).toBe(1500);
    expect(depois.active).toBe(true);
  });

  it("salvar sem mudar nada não apaga o que o formulário não mostra", async () => {
    // O maior risco de um formulário de edição é o campo AUSENTE: `services`
    // tem buffer antes, buffer depois, antecedência mínima e máxima e a
    // situação ativa/inativa, e nada disso aparece na gaveta. Se o UPDATE os
    // escrevesse com o padrão, cada salvamento silenciosamente zeraria a
    // configuração de agenda de quem mexeu no preço.
    const id = await createService(ctx(orgA), servicoBase);
    await db
      .update(s.services)
      .set({ bufferBeforeMin: 10, bufferAfterMin: 15, minLeadMinutes: 30, maxLeadDays: 90, active: false })
      .where(eq(s.services.id, id));
    const [antes] = await db.select().from(s.services).where(eq(s.services.id, id));

    await updateService(ctx(orgA), id, servicoBase);

    const [depois] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(depois).toEqual(antes);
  });

  it("NÃO edita o serviço de outra clínica", async () => {
    // O `where` casa id E organizationId: um id chutado no corpo da server
    // action não encontra linha nenhuma e a edição morre em NAO_ENCONTRADO.
    const id = await createService(ctx(orgA), servicoBase);
    await expect(
      updateService(ctx(orgB), id, { ...servicoBase, name: "Invadido" }),
    ).rejects.toBeInstanceOf(CatalogError);
    const [intacto] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(intacto.name).toBe(servicoBase.name);
  });

  it("recusa publicar no agendamento online sem profissional habilitado", async () => {
    // A criação já barra isso. Sem a mesma trava na edição, o serviço fica
    // listado em /agendar e a cliente recebe "nenhum dia livre" para sempre —
    // parece agenda cheia, é cadastro quebrado.
    const id = await createService(ctx(orgA), { ...servicoBase, professionalIds: [proA1] });
    await expect(
      updateService(ctx(orgA), id, {
        ...servicoBase,
        onlineBooking: true,
        professionalIds: [],
      }),
    ).rejects.toThrow(/pelo menos um profissional/i);
  });

  it("recusa profissional de outra clínica", async () => {
    const [intruso] = await db
      .insert(s.professionals)
      .values({ organizationId: orgB, name: `Intrusa ${SUFIXO}` })
      .returning({ id: s.professionals.id });
    const id = await createService(ctx(orgA), servicoBase);
    await expect(
      updateService(ctx(orgA), id, { ...servicoBase, professionalIds: [intruso.id] }),
    ).rejects.toThrow(/inválido/i);
  });

  it("preserva a comissão por profissional de quem continuou habilitado", async () => {
    // A gravação é POR DIFERENÇA. Apagar tudo e reinserir daria a mesma tela e
    // levaria junto o `commission_bps` da linha — o primeiro da precedência
    // quando o atendimento é fechado.
    const id = await createService(ctx(orgA), {
      ...servicoBase,
      professionalIds: [proA1, proA2],
    });
    await db
      .update(s.professionalServices)
      .set({ commissionBps: 3500 })
      .where(
        and(
          eq(s.professionalServices.serviceId, id),
          eq(s.professionalServices.professionalId, proA1),
        ),
      );

    await updateService(ctx(orgA), id, { ...servicoBase, professionalIds: [proA1] });

    const vinculos = await db
      .select()
      .from(s.professionalServices)
      .where(eq(s.professionalServices.serviceId, id));
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].professionalId).toBe(proA1);
    expect(vinculos[0].commissionBps).toBe(3500);
  });

  it("tira quem saiu e põe quem entrou", async () => {
    const id = await createService(ctx(orgA), { ...servicoBase, professionalIds: [proA1] });
    await updateService(ctx(orgA), id, { ...servicoBase, professionalIds: [proA2] });
    const vinculos = await db
      .select({ professionalId: s.professionalServices.professionalId })
      .from(s.professionalServices)
      .where(eq(s.professionalServices.serviceId, id));
    expect(vinculos.map((v) => v.professionalId)).toEqual([proA2]);
  });

  it("reaproveita a categoria existente em vez de duplicar", async () => {
    const id = await createService(ctx(orgA), { ...servicoBase, categoryName: "Pés" });
    await updateService(ctx(orgA), id, { ...servicoBase, categoryName: "pés" });
    const categorias = await db
      .select()
      .from(s.serviceCategories)
      .where(
        and(
          eq(s.serviceCategories.organizationId, orgA),
          eq(s.serviceCategories.name, "Pés"),
        ),
      );
    expect(categorias).toHaveLength(1);
  });
});

describe("o que a tela manda de volta", () => {
  it("aceita os ids de profissional como a página os entrega", async () => {
    // `array_agg` de bigint volta do Postgres como TEXTO, e o `sql<number[]>`
    // da página é anotação de tipo, não conversão. Sem converter, salvar
    // QUALQUER serviço com profissional vinculado morria em "expected number,
    // received string" — 6 dos 8 serviços da conta do dono.
    const id = await createService(ctx(orgA), { ...servicoBase, professionalIds: [proA1] });
    const [linha] = await db
      .select({
        ids: sql<string[]>`coalesce(array_agg(distinct ${s.professionalServices.professionalId}), '{}')`,
      })
      .from(s.professionalServices)
      .where(eq(s.professionalServices.serviceId, id));

    // É isto que o driver entrega hoje: texto.
    expect(typeof linha.ids[0]).toBe("string");
    // E é isto que a página precisa mandar para o domínio.
    const convertidos = [...linha.ids].map(Number);
    await expect(
      updateService(ctx(orgA), id, { ...servicoBase, professionalIds: convertidos }),
    ).resolves.toBeTruthy();
  });

  it("aceita serviço de cortesia, com preço zero", async () => {
    // O campo abria vazio e o botão Salvar ficava morto: um serviço grátis não
    // podia mais ser editado nem para deixar de ser grátis.
    const id = await createService(ctx(orgA), { ...servicoBase, priceCents: 0 });
    await updateService(ctx(orgA), id, { ...servicoBase, priceCents: 0, name: "Avaliação" });
    const [depois] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(depois.priceCents).toBe(0);
    expect(depois.name).toBe("Avaliação");
  });

  it("guarda comissão fracionada sem perder a casa decimal", async () => {
    const id = await createService(ctx(orgA), { ...servicoBase, commissionPct: 12.5 });
    const [depois] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(depois.commissionBps).toBe(1250);
  });
});

describe("desativar serviço", () => {
  it("desativa sem apagar, e conta o que já está marcado", async () => {
    // Apagar é impossível: `appointments.service_id` é chave estrangeira, e o
    // atendimento de março precisa continuar tendo nome.
    const id = await createService(ctx(orgA), servicoBase);
    const amanha = new Date(Date.now() + 24 * 3600 * 1000);
    await db.insert(s.appointments).values({
      organizationId: orgA,
      branchId: filialA,
      customerId: clienteA,
      professionalId: proA1,
      serviceId: id,
      startsAt: amanha,
      endsAt: new Date(amanha.getTime() + 3600 * 1000),
      priceCents: 8000,
    });

    expect(await futurosDoServico(ctx(orgA), id)).toBe(1);
    await setServiceActive(ctx(orgA), id, false);

    const [depois] = await db.select().from(s.services).where(eq(s.services.id, id));
    expect(depois.active).toBe(false);
    const marcados = await db
      .select()
      .from(s.appointments)
      .where(eq(s.appointments.serviceId, id));
    expect(marcados).toHaveLength(1);
  });

  it("não desativa serviço de outra clínica", async () => {
    const id = await createService(ctx(orgA), servicoBase);
    await expect(setServiceActive(ctx(orgB), id, false)).rejects.toBeInstanceOf(CatalogError);
  });

  it("não conta atendimento de outra clínica como futuro", async () => {
    const id = await createService(ctx(orgA), servicoBase);
    expect(await futurosDoServico(ctx(orgB), id)).toBe(0);
  });
});

describe("rastro da mudança", () => {
  it("registra só o que mudou, com o antes e o depois", async () => {
    // `audit_logs` existe desde a primeira migração e nunca ninguém escreveu
    // nela. Começa aqui porque é aqui que dinheiro muda de valor.
    const id = await createService(ctx(orgA), servicoBase);
    await updateService(ctx(orgA), id, { ...servicoBase, priceCents: 9900 });

    const linhas = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.organizationId, orgA), eq(s.auditLogs.entityId, id)));
    const edicao = linhas.find((l) => l.action === "updated");
    expect(edicao).toBeTruthy();
    expect(edicao!.entity).toBe("service");
    expect(edicao!.before).toEqual({ priceCents: 8000 });
    expect(edicao!.after).toEqual({ priceCents: 9900 });
  });

  it("não escreve linha quando nada mudou", async () => {
    // Diário que registra "salvou sem mudar nada" é diário que ninguém lê.
    const id = await createService(ctx(orgA), servicoBase);
    await updateService(ctx(orgA), id, servicoBase);
    const edicoes = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entityId, id), eq(s.auditLogs.action, "updated")));
    expect(edicoes).toHaveLength(0);
  });

  it("registra a desativação", async () => {
    const id = await createService(ctx(orgA), servicoBase);
    await setServiceActive(ctx(orgA), id, false);
    const linhas = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.entityId, id), eq(s.auditLogs.action, "deactivated")));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].after).toEqual({ active: false });
  });
});

describe("editar produto", () => {
  const produtoBase = {
    name: "Óleo de cutícula",
    categoryName: "Cuidados",
    description: null,
    sku: "OLEO-1",
    priceCents: 3500,
    costCents: 1200,
    stockQty: 10,
  };

  it("salva preço, estoque e SKU", async () => {
    const id = await createProduct(ctx(orgA), produtoBase);
    await updateProduct(ctx(orgA), id, { ...produtoBase, priceCents: 3900, stockQty: 4 });
    const [depois] = await db.select().from(s.products).where(eq(s.products.id, id));
    expect(depois.priceCents).toBe(3900);
    expect(depois.stockQty).toBe(4);
    expect(depois.sku).toBe("OLEO-1");
  });

  it("NÃO edita o produto de outra clínica", async () => {
    const id = await createProduct(ctx(orgA), produtoBase);
    await expect(
      updateProduct(ctx(orgB), id, { ...produtoBase, name: "Invadido" }),
    ).rejects.toBeInstanceOf(CatalogError);
    const [intacto] = await db.select().from(s.products).where(eq(s.products.id, id));
    expect(intacto.name).toBe(produtoBase.name);
  });
});
