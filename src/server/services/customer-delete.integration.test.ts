import { randomBytes } from "node:crypto";
import { generateAccountCode } from "@/lib/account-code";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import type { TenantContext } from "@/server/auth";
import { CustomerError, deleteCustomer } from "./customer-service";

/**
 * Excluir cliente.
 *
 * O que está protegido aqui é o que a tela não mostra: a exclusão que apaga
 * atendimento e caixa junto (`appointments.customer_id` é obrigatório e a
 * comissão depende dele), a conversa de WhatsApp levada de arrasto, o
 * telefone que sobra no rastro de auditoria, e a clínica que apaga o cliente
 * da vizinha.
 */

const SUFIXO = `vitest-cliente-${randomBytes(4).toString("hex")}`;
let orgA = 0;
let orgB = 0;
let filialA = 0;
let proA = 0;
let servicoA = 0;
let etiquetaA = 0;
let regraA = 0;

const ctx = (organizationId: number): TenantContext =>
  ({ organizationId, userId: 1, role: "admin" }) as TenantContext;

const novoCliente = async (organizationId: number, extra: Partial<typeof s.customers.$inferInsert> = {}) => {
  const [row] = await db
    .insert(s.customers)
    .values({ organizationId, name: `Cliente ${randomBytes(3).toString("hex")} ${SUFIXO}`, ...extra })
    .returning({ id: s.customers.id });
  return row.id;
};

const existe = async (id: number) =>
  (await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.id, id))).length === 1;

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

  const [pro] = await db
    .insert(s.professionals)
    .values({ organizationId: orgA, name: `Paula ${SUFIXO}` })
    .returning({ id: s.professionals.id });
  proA = pro.id;

  const [servico] = await db
    .insert(s.services)
    .values({ organizationId: orgA, name: `Serviço ${SUFIXO}`, durationMin: 60, priceCents: 8000 })
    .returning({ id: s.services.id });
  servicoA = servico.id;

  const [etiqueta] = await db
    .insert(s.customerTags)
    .values({ organizationId: orgA, name: `VIP ${SUFIXO}` })
    .returning({ id: s.customerTags.id });
  etiquetaA = etiqueta.id;

  const [regra] = await db
    .insert(s.automationRules)
    .values({
      organizationId: orgA,
      name: `Regra ${SUFIXO}`,
      trigger: "before_appointment",
      daysOffset: 1,
      messageTemplate: "Oi, {nome}!",
    })
    .returning({ id: s.automationRules.id });
  regraA = regra.id;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await db.delete(s.auditLogs).where(eq(s.auditLogs.organizationId, id));
    await db.delete(s.automationDispatches).where(eq(s.automationDispatches.organizationId, id));
    await db.delete(s.aiAgentCustomerMemos).where(eq(s.aiAgentCustomerMemos.organizationId, id));
    await db.delete(s.customerTagLinks).where(eq(s.customerTagLinks.organizationId, id));
    await db.delete(s.payments).where(eq(s.payments.organizationId, id));
    await db.delete(s.appointments).where(eq(s.appointments.organizationId, id));
    await db.delete(s.conversations).where(eq(s.conversations.organizationId, id));
    await db.delete(s.customers).where(eq(s.customers.organizationId, id));
  }
  await db.delete(s.automationRules).where(eq(s.automationRules.organizationId, orgA));
  await db.delete(s.customerTags).where(eq(s.customerTags.organizationId, orgA));
  await db.delete(s.services).where(eq(s.services.organizationId, orgA));
  await db.delete(s.professionals).where(eq(s.professionals.organizationId, orgA));
  await db.delete(s.branches).where(eq(s.branches.organizationId, orgA));
  for (const id of [orgA, orgB]) await db.delete(s.organizations).where(eq(s.organizations.id, id));
  await pool.end();
});

describe("excluir cliente", () => {
  it("exclui o cliente sem histórico e leva junto só o que era dele", async () => {
    const id = await novoCliente(orgA, { phone: "5584999990001", email: "sumir@exemplo.test" });
    await db.insert(s.customerTagLinks).values({ organizationId: orgA, customerId: id, tagId: etiquetaA });
    await db.insert(s.aiAgentCustomerMemos).values({ organizationId: orgA, customerId: id, content: "Prefere manhã." });
    await db.insert(s.automationDispatches).values({
      organizationId: orgA,
      ruleId: regraA,
      customerId: id,
      sourceType: "appointment",
      sourceId: 1,
      scheduledFor: new Date(),
      status: "sent",
      message: "Lembrete",
    });
    const [conversa] = await db
      .insert(s.conversations)
      .values({
        organizationId: orgA,
        customerId: id,
        remoteJid: `5584999990001-${SUFIXO}@s.whatsapp.net`,
        status: "open",
      })
      .returning({ id: s.conversations.id });

    await deleteCustomer(ctx(orgA), id);

    expect(await existe(id)).toBe(false);
    expect(await db.select().from(s.customerTagLinks).where(eq(s.customerTagLinks.customerId, id))).toHaveLength(0);
    expect(await db.select().from(s.aiAgentCustomerMemos).where(eq(s.aiAgentCustomerMemos.customerId, id))).toHaveLength(0);
    expect(await db.select().from(s.automationDispatches).where(eq(s.automationDispatches.customerId, id))).toHaveLength(0);

    // A conversa é histórico do atendimento: fica, só perde o vínculo.
    const [restante] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversa.id));
    expect(restante).toBeDefined();
    expect(restante.customerId).toBeNull();
  });

  it("registra a exclusão no rastro sem guardar telefone nem e-mail", async () => {
    const id = await novoCliente(orgA, { phone: "5584999990002", email: "privado@exemplo.test", notes: "anotação" });
    await deleteCustomer(ctx(orgA), id);

    const [rastro] = await db
      .select()
      .from(s.auditLogs)
      .where(and(eq(s.auditLogs.organizationId, orgA), eq(s.auditLogs.entity, "customer"), eq(s.auditLogs.entityId, id)));
    expect(rastro.action).toBe("deleted");
    expect(rastro.actorId).toBe(1);
    const antes = JSON.stringify(rastro.before);
    expect(antes).toContain("Cliente");
    expect(antes).not.toContain("5584999990002");
    expect(antes).not.toContain("privado@exemplo.test");
    expect(antes).not.toContain("anotação");
    expect(rastro.after).toBeNull();
  });

  it("recusa quando o cliente tem atendimento, e nada some", async () => {
    const id = await novoCliente(orgA);
    const ontem = new Date(Date.now() - 24 * 3600 * 1000);
    await db.insert(s.appointments).values({
      organizationId: orgA,
      branchId: filialA,
      customerId: id,
      professionalId: proA,
      serviceId: servicoA,
      startsAt: ontem,
      endsAt: new Date(ontem.getTime() + 3600 * 1000),
      status: "completed",
      priceCents: 8000,
    });
    await db.insert(s.customerTagLinks).values({ organizationId: orgA, customerId: id, tagId: etiquetaA });

    const erro = await deleteCustomer(ctx(orgA), id).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CustomerError);
    expect((erro as CustomerError).code).toBe("HAS_HISTORY");
    expect((erro as CustomerError).message).toContain("1 atendimento");

    // Recusar não pode ter apagado nada pelo caminho: a transação nem começou.
    expect(await existe(id)).toBe(true);
    expect(await db.select().from(s.customerTagLinks).where(eq(s.customerTagLinks.customerId, id))).toHaveLength(1);
    expect(await db.select().from(s.appointments).where(eq(s.appointments.customerId, id))).toHaveLength(1);
  });

  it("recusa quando o cliente só tem pagamento, sem atendimento", async () => {
    const id = await novoCliente(orgA);
    await db.insert(s.payments).values({ organizationId: orgA, customerId: id, method: "pix", amountCents: 5000 });

    const erro = await deleteCustomer(ctx(orgA), id).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CustomerError);
    expect((erro as CustomerError).code).toBe("HAS_HISTORY");
    expect((erro as CustomerError).message).toContain("1 pagamento");
    expect(await existe(id)).toBe(true);
  });

  it("não exclui cliente de outra clínica", async () => {
    const daVizinha = await novoCliente(orgB);

    const erro = await deleteCustomer(ctx(orgA), daVizinha).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CustomerError);
    expect((erro as CustomerError).code).toBe("NOT_FOUND");
    expect(await existe(daVizinha)).toBe(true);
  });

  it("cliente inexistente devolve não encontrado", async () => {
    const erro = await deleteCustomer(ctx(orgA), 2_000_000_000).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CustomerError);
    expect((erro as CustomerError).code).toBe("NOT_FOUND");
  });
});
