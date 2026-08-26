import { describe, expect, it } from "vitest";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TenantContext } from "@/server/auth";
import {
  getAvailableSlots,
  getAvailableSlotsByDay,
} from "./availability-service";

/**
 * A busca por intervalo tem que dar EXATAMENTE o mesmo resultado que a busca
 * dia a dia.
 *
 * Ela existe só por desempenho: um mês custava 186 idas ao banco (seis por
 * dia), medido entre 1,6 e 2,5 segundos, e era isso que tornava impossível
 * navegar entre meses. A regra de disponibilidade é a mesma função pura nos
 * dois caminhos — este teste é o que garante que continua sendo, contra os
 * dados reais de uma clínica com jornada, bloqueios e agendamentos de verdade.
 */

const DIAS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

describe("disponibilidade por intervalo", () => {
  it("bate com a consulta dia a dia, horário por horário", async () => {
    const [org] = await db
      .select({ id: s.organizations.id, timezone: s.organizations.timezone })
      .from(s.organizations)
      .where(eq(s.organizations.slug, "clinica-lumina"))
      .limit(1);
    expect(org, "a clínica de demonstração precisa existir").toBeTruthy();

    const [servico] = await db
      .select({ id: s.services.id })
      .from(s.services)
      .where(
        and(
          eq(s.services.organizationId, org.id),
          eq(s.services.onlineBooking, true),
          eq(s.services.active, true),
        ),
      )
      .limit(1);
    expect(servico, "a clínica precisa ter serviço publicado").toBeTruthy();

    const ctx = {
      organizationId: org.id,
      timezone: org.timezone,
      userId: 1,
      role: "owner",
    } as TenantContext;

    const porIntervalo = await getAvailableSlotsByDay(ctx, {
      serviceId: servico.id,
      dateISOs: DIAS,
    });

    for (const dateISO of DIAS) {
      const umDia = await getAvailableSlots(ctx, {
        serviceId: servico.id,
        dateISO,
      });
      const doIntervalo = porIntervalo.get(dateISO) ?? [];
      const chave = (lista: typeof umDia) =>
        lista
          .map(
            (slot) =>
              `${slot.start.toISOString()}|${slot.professionalId}|${slot.branchId}|${slot.resourceId ?? "-"}`,
          )
          .sort()
          .join(",");
      expect(chave(doIntervalo), `dia ${dateISO}`).toBe(chave(umDia));
    }
  }, 180_000);

  it("devolve mapa vazio sem estourar quando não há dia nenhum", async () => {
    const ctx = {
      organizationId: 1,
      timezone: "America/Sao_Paulo",
      userId: 1,
      role: "owner",
    } as TenantContext;
    expect(
      (await getAvailableSlotsByDay(ctx, { serviceId: 1, dateISOs: [] })).size,
    ).toBe(0);
  });
});
