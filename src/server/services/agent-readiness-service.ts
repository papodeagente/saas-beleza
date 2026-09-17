import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { professionalServices, professionalWorkingHours, professionals, services } from "@/db/schema";
import type { ItemDeProntidao, Prontidao } from "@/domain/agente";
import type { TenantContext } from "@/server/auth";
import { getConnection } from "@/server/services/whatsapp-connection-service";

/**
 * O que precisa estar cadastrado para a agente conseguir atender.
 *
 * Existe porque a promessa "ative e ela já consulta seus serviços, preços e
 * agenda" é falsa numa conta vazia, e conta vazia é o caso COMUM: medido em
 * produção, duas das contas reais têm zero serviço, zero profissional e zero
 * jornada. Sem estes quatro elos, `list_services` devolve lista vazia e
 * `check_availability` devolve zero para qualquer data — as duas com sucesso e
 * sem explicar nada ao modelo, que então não tem o que dizer e transfere.
 *
 * A regra do produto é que a agente nunca inventa. A consequência honesta disso
 * é que ela também não inventa o cadastro: quem tem que preencher é a dona, e a
 * tela precisa dizer o que falta em vez de ativar uma agente muda.
 */

export async function verificarProntidao(ctx: TenantContext): Promise<Prontidao> {
  const [[servicosComPreco], [profissionaisAtivos], [jornadas], conexao] = await Promise.all([
    /**
     * Serviço que alguém de verdade consegue executar, não serviço solto.
     *
     * Contar as três coisas separadamente dava prontidão FALSA: uma conta com
     * serviço, com profissional e com jornada, mas sem o vínculo entre serviço e
     * profissional, passava na checagem e nunca achava um horário — porque a
     * varredura de disponibilidade começa justamente por `professional_services`
     * e devolve lista vazia sem reclamar de nada.
     */
    db
      .select({ total: sql<number>`count(distinct ${services.id})`.mapWith(Number) })
      .from(services)
      .innerJoin(professionalServices, eq(professionalServices.serviceId, services.id))
      .innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
      .innerJoin(
        professionalWorkingHours,
        eq(professionalWorkingHours.professionalId, professionals.id),
      )
      .where(
        and(
          eq(services.organizationId, ctx.organizationId),
          eq(services.active, true),
          gt(services.priceCents, 0),
          eq(professionals.active, true),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(professionals)
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true))),
    // A jornada é contada pelo profissional ATIVO: grade de quem foi desligado
    // não abre horário nenhum, e contá-la daria prontidão falsa.
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(professionalWorkingHours)
      .innerJoin(professionals, eq(professionals.id, professionalWorkingHours.professionalId))
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true))),
    getConnection(ctx),
  ]);

  const itens: ItemDeProntidao[] = [
    {
      chave: "servicos",
      acao: "Cadastrar",
      rotulo: "Serviço que alguém atende",
      ok: (servicosComPreco?.total ?? 0) > 0,
      comoResolver:
        "Cadastre um serviço com preço e ligue ao menos uma profissional a ele. É de onde ela tira o que responder.",
      href: "/catalogo",
    },
    {
      chave: "profissionais",
      acao: "Cadastrar",
      rotulo: "Quem atende",
      ok: (profissionaisAtivos?.total ?? 0) > 0,
      comoResolver: "Cadastre pelo menos uma profissional, mesmo que seja você.",
      href: "/gestao",
    },
    {
      chave: "jornada",
      acao: "Definir",
      rotulo: "Dias e horários de trabalho",
      ok: (jornadas?.total ?? 0) > 0,
      comoResolver: "Marque os dias e horários em que vocês atendem. Sem isso ela nunca acha vaga.",
      href: "/agenda",
    },
    {
      chave: "whatsapp",
      acao: "Conectar",
      rotulo: "WhatsApp conectado",
      ok: conexao?.status === "connected",
      comoResolver: "Conecte o WhatsApp para ela falar com as suas clientes.",
      href: "/whatsapp",
    },
  ];

  const atender = itens.filter((item) => item.chave !== "whatsapp");
  return {
    prontaParaAtender: atender.every((item) => item.ok),
    prontaParaResponder: itens.every((item) => item.ok),
    itens,
  };
}
