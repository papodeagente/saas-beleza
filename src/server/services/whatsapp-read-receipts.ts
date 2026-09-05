import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, whatsappConnections } from "@/db/schema";
import { aconteceuEm } from "@/server/services/inbox-service";
import { markMessagesRead } from "@/server/whatsapp/uazapi-client";

/**
 * Confirmação de leitura: os dois tiques azuis no aparelho da cliente.
 *
 * Decisão do dono (24/08): abrir a conversa no Inbox marca as mensagens como
 * lidas no WhatsApp. É o que a cliente espera de uma conversa que ela mandou —
 * sem isso os tiques ficam cinza para sempre e a clínica parece nunca ter
 * visto a mensagem, mesmo tendo respondido.
 *
 * Três cuidados que a implementação precisa ter:
 *
 * 1. É BEST-EFFORT. Nada aqui pode derrubar a abertura da conversa: se a
 *    uazapi estiver fora do ar, a atendente ainda tem que conseguir ler e
 *    responder. Toda falha é engolida com aviso no log, nunca propagada.
 *
 * 2. É IDEMPOTENTE POR CONVERSA, com respiro. Sem isso, a leitura periódica e
 *    cada re-render disparariam a chamada de novo para as mesmas mensagens. O
 *    respiro vive em memória de propósito: perder o registro num restart custa
 *    uma chamada repetida, o que é inofensivo, enquanto uma coluna nova no
 *    banco custaria uma escrita por abertura.
 *
 * 3. Só mensagens RECEBIDAS entram. Marcar como lida a própria mensagem
 *    enviada não significa nada para o provedor e só gastaria cota.
 */

/** Última confirmação enviada por conversa, para não repetir a chamada. */
const ultimoAviso = new Map<number, number>();
const RESPIRO_MS = 60_000;
/**
 * A doc aceita uma lista de ids. Mais que isso numa tacada é sinal de conversa
 * recém-importada, não de leitura real — e não vale gastar a chamada.
 */
const LIMITE_IDS = 50;

export async function markConversationReadOnWhatsapp(
  organizationId: number,
  conversationId: number,
): Promise<void> {
  try {
    const agora = Date.now();
    const anterior = ultimoAviso.get(conversationId);
    if (anterior && agora - anterior < RESPIRO_MS) return;

    const [conversation] = await db
      .select({ remoteJid: conversations.remoteJid, connectionId: conversations.connectionId })
      .from(conversations)
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
      )
      .limit(1);
    if (!conversation?.remoteJid) return;

    // A conversa guarda por qual conexão ela entrou; usar a conexão "da
    // organização" quebraria no dia em que existir mais de um número.
    const [connection] = await db
      .select({ baseUrl: whatsappConnections.baseUrl, instanceToken: whatsappConnections.instanceToken })
      .from(whatsappConnections)
      .where(
        and(
          eq(whatsappConnections.organizationId, organizationId),
          conversation.connectionId
            ? eq(whatsappConnections.id, conversation.connectionId)
            : eq(whatsappConnections.status, "connected"),
        ),
      )
      .limit(1);
    if (!connection?.baseUrl || !connection.instanceToken) return;

    const pendentes = await db
      .select({ externalId: messages.externalId })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          isNotNull(messages.externalId),
          // `read` é o topo do ranque de status: o que já chegou lá não volta.
          sql`${messages.status} is distinct from 'read'`,
        ),
      )
      // As mais recentes pelo que ACONTECEU. Por `created_at`, numa conversa
      // recém-importada as "mais recentes" são as linhas gravadas na
      // importação — e o tique azul ia parar em mensagens de julho enquanto a
      // que a cliente acabou de mandar seguia sem ler no aparelho.
      .orderBy(desc(aconteceuEm), desc(messages.id))
      .limit(LIMITE_IDS);

    const ids = pendentes.map((m) => m.externalId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;

    ultimoAviso.set(conversationId, agora);
    await markMessagesRead({ baseUrl: connection.baseUrl, token: connection.instanceToken }, ids);

    // O provedor confirmou; refletir no banco evita reenviar os mesmos ids na
    // próxima abertura e deixa o fio coerente com o que a cliente vê.
    await db
      .update(messages)
      .set({ status: "read" })
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          inArray(messages.externalId, ids),
        ),
      )
      .catch(() => {});
  } catch (error) {
    // Ler a conversa nunca pode falhar porque o WhatsApp não respondeu.
    console.warn(
      "[confirmação de leitura] não enviada:",
      error instanceof Error ? error.message : error,
    );
  }
}
