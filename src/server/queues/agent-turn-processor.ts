import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiAgents, conversations, messages } from "@/db/schema";
import { executeAgentTurn } from "@/server/ai/orchestrator";
import { aconteceuEm } from "@/server/services/inbox-service";
import { sendMessageToConversation } from "@/server/services/whatsapp-message-service";
import { acquireConversationLock, incrementWindow, releaseConversationLock } from "@/server/queues/redis";
import type { AgentTurnJob } from "@/server/queues/agent-turn-queue";

/**
 * Processa um turno do agente.
 *
 * Todo caminho de saída aqui é guardado por uma sequência de portões que
 * existem por incidentes reais no entur-os-crm, e cada um deles é a razão de o
 * turno poder terminar sem resposta:
 *
 *  - pausa da conversa, relida imediatamente antes do envio (uma atendente pode
 *    ter clicado em pausar enquanto o modelo pensava);
 *  - humano respondeu depois do agente, o que devolve a conversa à pessoa;
 *  - limites por organização e por conversa, contra laço de resposta;
 *  - lock por conversa, para uma réplica só processar por vez;
 *  - marca-d'água do último inbound respondido, que impede resposta duplicada
 *    quando o job é reentregue.
 *
 * Nada aqui lança: o retorno diz o que aconteceu, e o erro fica no log.
 */

export type TurnOutcome = { status: "sent" | "skipped" | "error"; reason?: string };

/**
 * Quanto da espera o cliente vê como "Digitando...".
 *
 * É a fatia que entregamos à uazapi. Curta de propósito: enquanto ela segura a
 * mensagem, a conversa já saiu das nossas mãos e pausar a IA não a alcança
 * mais.
 */
const ATRASO_DIGITANDO_MS = 8_000;

/**
 * Divide o atraso configurado entre nós e o provedor.
 *
 * A fatia final vai para o campo `delay` do /send/text, que é o que faz o
 * cliente ver "Digitando..." — um `setTimeout` nosso deixava a conversa muda
 * durante toda a espera. A fatia longa continua sendo nossa, e é o que mantém
 * duas garantias: pausar a IA ainda cancela a resposta durante quase toda a
 * espera, e a requisição de /send/text não fica minutos aberta (o endpoint não
 * é idempotente e o cliente repete falha de rede — conexão presa vira mensagem
 * duplicada para um cliente real).
 */
export function dividirAtraso(totalMs: number): { nosso: number; provedor: number } {
  const total = Number.isFinite(totalMs) ? Math.max(0, Math.round(totalMs)) : 0;
  const provedor = Math.min(total, ATRASO_DIGITANDO_MS);
  return { nosso: total - provedor, provedor };
}

/**
 * Releitura da pausa no instante do envio.
 *
 * O valor lido no início do turno já está velho quando o modelo termina; entre
 * os dois momentos cabe um clique em "pausar IA". Sem esta segunda leitura o
 * agente responde depois de ter sido silenciado, que é exatamente o que a
 * atendente tentou evitar.
 */
async function isPausedNow(conversationId: number): Promise<boolean> {
  const [row] = await db
    .select({ pausedAt: conversations.aiPausedAt, status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return Boolean(row?.pausedAt);
}

export async function processAgentTurn(job: AgentTurnJob): Promise<TurnOutcome> {
  const { organizationId, conversationId } = job;

  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(eq(aiAgents.organizationId, organizationId))
    .orderBy(asc(aiAgents.id))
    .limit(1);
  if (!agent) return { status: "skipped", reason: "sem_agente" };
  if (agent.status !== "active") return { status: "skipped", reason: "agente_inativo" };
  if (!agent.enabled) return { status: "skipped", reason: "agente_desligado" };

  const [conversation] = await db
    .select({
      id: conversations.id,
      customerId: conversations.customerId,
      isGroup: conversations.isGroup,
      aiPausedAt: conversations.aiPausedAt,
      watermark: conversations.aiLastProcessedInboundAt,
      watermarkId: conversations.aiLastProcessedInboundId,
      remoteJid: conversations.remoteJid,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  if (!conversation) return { status: "skipped", reason: "conversa_inexistente" };
  if (conversation.aiPausedAt) return { status: "skipped", reason: "pausado_pelo_usuario" };
  if (conversation.isGroup && !agent.respondGroups) return { status: "skipped", reason: "grupo" };

  // Humano assumiu: a última saída da conversa foi de uma pessoa, e ela é mais
  // recente do que a última fala do agente.
  if (agent.pauseOnHumanReply) {
    const [lastOutbound] = await db
      .select({ sender: messages.sender, createdAt: aconteceuEm })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
        ),
      )
      .orderBy(desc(aconteceuEm), desc(messages.id))
      .limit(1);
    if (lastOutbound && lastOutbound.sender === "user") {
      return { status: "skipped", reason: "humano_assumiu" };
    }
  }

  const orgCount = await incrementWindow(`agent:rate:org:${organizationId}`);
  if (orgCount > agent.maxTurnsPerMinutePerOrg) {
    return { status: "skipped", reason: "limite_organizacao" };
  }
  const convCount = await incrementWindow(`agent:rate:conv:${conversationId}`);
  if (convCount > agent.maxTurnsPerMinutePerContact) {
    return { status: "skipped", reason: "limite_conversa" };
  }

  const locked = await acquireConversationLock(conversationId);
  if (!locked) return { status: "skipped", reason: "conversa_travada" };

  try {
    // A marca-d'água é o maior entre o último inbound já respondido e a última
    // fala do agente. Usar só a segunda deixa uma janela: o eco do envio chega
    // pelo webhook depois, e nesse intervalo um retry responderia de novo.
    const [lastAgentMessage] = await db
      .select({ createdAt: aconteceuEm, id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
        ),
      )
      .orderBy(desc(aconteceuEm), desc(messages.id))
      .limit(1);

    /**
     * A marca é um PAR: (hora do evento, id).
     *
     * Só a hora não serve porque o provedor carimba em SEGUNDOS cheios — 3.196
     * de 3.196 entradas da base têm milissegundo zerado — enquanto as saídas
     * que nós gravamos têm fração. Com `>` estrito sobre a hora sozinha, a
     * mensagem da cliente que cai no mesmo segundo da resposta anterior nunca
     * passa, e não passa NUNCA MAIS: a marca não desce. Reproduzido: existem 96
     * pares de entradas no mesmo segundo em 25 conversas, e um par real
     * saída→entrada na conversa 2423.
     *
     * O par é a mesma régua de todo `ORDER BY` desta correção.
     */
    const marcas: Array<{ quando: Date; id: number }> = [];
    if (conversation.watermark instanceof Date) {
      marcas.push({ quando: conversation.watermark, id: conversation.watermarkId ?? 0 });
    }
    if (lastAgentMessage?.createdAt instanceof Date) {
      marcas.push({ quando: lastAgentMessage.createdAt, id: lastAgentMessage.id });
    }
    const threshold = marcas.length
      ? marcas.reduce((a, b) =>
          a.quando.getTime() !== b.quando.getTime()
            ? a.quando.getTime() >= b.quando.getTime()
              ? a
              : b
            : a.id >= b.id
              ? a
              : b,
        )
      : null;

    const pending = await db
      .select({
        id: messages.id,
        body: messages.body,
        messageType: messages.messageType,
        transcription: messages.audioTranscription,
        createdAt: aconteceuEm,
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          /*
            OS DOIS LADOS NA MESMA ESCALA, sempre.

            A marca-d'água é gravada a partir do `createdAt` que sai DESTA
            consulta. Mudar só um dos lados é o pior cenário possível: marca em
            hora de evento comparada com hora de gravação libera a conversa
            inteira a cada turno, ou a tranca para sempre.

            Mudar agora é o momento mais barato — `ai_last_processed_inbound_at`
            está nulo em 158 de 158 conversas, então não existe marca antiga na
            escala velha para ficar inconsistente.

            E o motivo de mudar: a importação de histórico grava 200 mensagens
            com `created_at` de AGORA. Todas passariam da marca-d'água de uma
            vez, e o agente responderia a uma pergunta de julho como se ela
            tivesse acabado de chegar.
          */
          /*
            OS DOIS LADOS NO MESMO SEGUNDO, e só então o desempate por id.

            O par sozinho não resolvia: o provedor carimba a ENTRADA em segundo
            cheio (3.196 de 3.196 da base com milissegundo zerado) e a SAÍDA que
            nós gravamos tem fração. A resposta da IA às 15:31:00.900 e a
            mensagem da cliente logo depois, carimbada 15:31:00.000, comparadas
            direto, dizem que a cliente falou ANTES — e ela some como gatilho
            para sempre, porque a marca nunca desce.

            Truncar os dois lados ao segundo devolve a comparação ao terreno
            comum; o id decide dentro do segundo, e id é monotônico com a
            inserção. A entrada importada de julho continua barrada, porque aí a
            diferença é de meses, não de fração.
          */
          threshold
            ? sql`(date_trunc('second', ${aconteceuEm}), ${messages.id}) > (date_trunc('second', ${threshold.quando}::timestamptz), ${threshold.id})`
            : undefined,
        ),
      )
      .orderBy(asc(aconteceuEm), asc(messages.id));

    const usable = pending.filter((m) => {
      if (m.messageType === "audio") return Boolean(m.transcription?.trim());
      return Boolean(m.body?.trim());
    });

    if (usable.length === 0) {
      // Áudio ainda sendo transcrito: não responde agora para não ignorar o que
      // o cliente falou. A próxima mensagem ou o retry retomam o turno.
      const waitingAudio = pending.some((m) => m.messageType === "audio" && !m.transcription?.trim());
      return { status: "skipped", reason: waitingAudio ? "audio_em_transcricao" : "sem_mensagem_nova" };
    }

    // Rajada vira um texto só: o agente responde a tudo de uma vez.
    const userText = usable
      .map((m) => (m.messageType === "audio" ? (m.transcription ?? "") : m.body))
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n");
    // A marca grava o PAR da última entrada respondida: a hora e o id.
    const ultima = usable[usable.length - 1];
    const lastInboundAt = ultima.createdAt;
    const lastInboundId = ultima.id;

    const result = await executeAgentTurn({
      organizationId,
      conversationId,
      customerId: conversation.customerId,
      userText,
      source: "whatsapp",
    });

    if (!result.reply.trim()) {
      // Sem texto: só houve ferramenta (uma transferência, por exemplo). Ainda
      // assim a marca-d'água avança, senão o turno se repete em laço.
      await db
        .update(conversations)
        .set({ aiLastProcessedInboundAt: lastInboundAt, aiLastProcessedInboundId: lastInboundId })
        .where(eq(conversations.id, conversationId));
      if (result.effect?.type === "transfer_to_human") {
        await applyTransfer(organizationId, conversationId, result.effect.reason, result.effect.summary);
      }
      return { status: "skipped", reason: "resposta_vazia" };
    }

    // A espera longa vem ANTES da releitura da pausa, e essa ordem é a regra:
    // é ela que faz um clique em "pausar IA" durante a espera realmente
    // impedir a resposta. Entregar o atraso inteiro ao provedor invertia isso.
    const atraso = dividirAtraso(agent.responseDelaySeconds * 1000);
    if (atraso.nosso > 0) {
      await new Promise((resolve) => setTimeout(resolve, atraso.nosso));
    }

    if (await isPausedNow(conversationId)) {
      return { status: "skipped", reason: "pausado_durante_o_turno" };
    }

    // Marca antes de enviar: se o envio falhar, o pior caso é o cliente ficar
    // sem resposta e alguém ver o erro — melhor do que receber duas.
    await db
      .update(conversations)
      .set({
        aiLastProcessedInboundAt: lastInboundAt,
        aiLastProcessedInboundId: lastInboundId,
        controlledBy: "ai",
      })
      .where(eq(conversations.id, conversationId));

    // Só os últimos segundos vão para o provedor: o suficiente para o cliente
    // ver "Digitando..." antes da mensagem cair, sem abrir uma janela em que
    // pausar a IA não faz mais efeito.
    await sendMessageToConversation(organizationId, conversationId, result.reply, {
      sender: "ai",
      delayMs: atraso.provedor,
    });

    if (result.effect?.type === "transfer_to_human") {
      await applyTransfer(organizationId, conversationId, result.effect.reason, result.effect.summary);
    }

    return { status: "sent" };
  } catch (error) {
    console.error(
      `[agent] falha no turno conv=${conversationId}:`,
      error instanceof Error ? error.message : error,
    );
    return { status: "error", reason: error instanceof Error ? error.message : "erro" };
  } finally {
    await releaseConversationLock(conversationId);
  }
}

/**
 * Transferência para humano: a conversa volta para a fila, com a IA pausada e
 * uma nota do que o cliente queria. Não escolhe atendente — quem estiver livre
 * puxa, que é como a fila funciona.
 */
async function applyTransfer(
  organizationId: number,
  conversationId: number,
  reason: string,
  summary: string,
): Promise<void> {
  await db
    .update(conversations)
    .set({ controlledBy: "waiting", aiPausedAt: new Date(), status: "open" })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)));

  await db.insert(messages).values({
    organizationId,
    conversationId,
    direction: "outbound",
    sender: "system",
    body: `Transferido para atendimento humano. Motivo: ${reason}. Resumo: ${summary}`,
    messageType: "system",
    status: "sent",
    sentAt: new Date(),
  });
}

export const _refs = { inArray, isNotNull };
