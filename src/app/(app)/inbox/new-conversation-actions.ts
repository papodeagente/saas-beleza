"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  type OutboundCustomerOption,
  searchCustomersForOutbound,
  startOutboundConversation,
} from "@/server/services/outbound-conversation-service";

/**
 * Ações da conversa iniciada pela clínica.
 *
 * Arquivo separado de `actions.ts` de propósito: as duas telas evoluem em
 * ritmos diferentes e "use server" exporta TUDO o que está no módulo como
 * endpoint, então manter aqui só o que esta caixa precisa reduz a superfície.
 */

/**
 * Traduz a exceção para uma frase que a atendente consegue usar.
 *
 * O redirect do Next é RE-LANÇADO: ele é o mecanismo que leva quem está com a
 * assinatura vencida para a tela de planos, e engoli-lo transformaria isso num
 * aviso vermelho sem saída.
 */
function mensagemDeErro(error: unknown, padrao: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  ) {
    throw error;
  }
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? padrao;
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return "Seu acesso não permite começar conversa. Fale com a gestão.";
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return "Sua sessão expirou. Entre de novo.";
  }
  console.error(error);
  return padrao;
}

export type CustomerSearchResult =
  | { ok: true; rows: OutboundCustomerOption[] }
  | { ok: false; error: string };

/**
 * Busca no SERVIDOR, a cada tecla (com espera na tela).
 *
 * Filtrar no navegador uma lista pré-carregada só funciona enquanto a clínica é
 * pequena: na centésima cliente, a que a atendente procura simplesmente não
 * está na página, e a tela responde "nenhuma encontrada" para alguém que existe.
 */
export async function searchCustomersForNewConversationAction(
  query: string,
): Promise<CustomerSearchResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const rows = await searchCustomersForOutbound(ctx, z.string().max(120).parse(query));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível buscar as clientes agora.") };
  }
}

const startSchema = z
  .object({
    customerId: z.number().int().positive().nullable().optional(),
    phone: z.string().trim().max(30).optional(),
    name: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1, "Escreva a mensagem antes de enviar.").max(4000),
  })
  .refine((v) => Boolean(v.customerId) || Boolean(v.phone), {
    message: "Escolha uma cliente ou digite o número.",
  });

export type StartConversationActionResult =
  | { ok: true; conversationId: number; reused: boolean }
  | { ok: false; error: string };

/**
 * Começa (ou retoma) a conversa e já manda a primeira mensagem.
 *
 * `staff` no mínimo: quem atende no salão — o papel `professional` — não fala
 * com a cliente em nome da clínica.
 */
export async function startConversationAction(
  input: unknown,
): Promise<StartConversationActionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "staff");
    const data = startSchema.parse(input);

    const resultado = await startOutboundConversation(ctx, {
      customerId: data.customerId ?? null,
      phone: data.phone,
      name: data.name,
      body: data.body,
    });
    if (!resultado.ok) return { ok: false, error: resultado.error };

    revalidatePath("/inbox");
    return { ok: true, conversationId: resultado.conversationId, reused: resultado.reused };
  } catch (error) {
    return { ok: false, error: mensagemDeErro(error, "Não foi possível começar a conversa.") };
  }
}
