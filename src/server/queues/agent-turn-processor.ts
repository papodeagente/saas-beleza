import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { aiAgents, conversations, messages } from "@/db/schema";
import { executeAgentTurn } from "@/server/ai/orchestrator";
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
      .select({ sender: messages.sender, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
        ),
      )
      .orderBy(desc(messages.createdAt))
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
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const candidates = [conversation.watermark, lastAgentMessage?.createdAt].filter(
      (d): d is Date => d instanceof Date,
    );
    const threshold = candidates.length
      ? candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
      : null;

    const pending = await db
      .select({
        id: messages.id,
        body: messages.body,
        messageType: messages.messageType,
        transcription: messages.audioTranscription,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          threshold ? gt(messages.createdAt, threshold) : undefined,
        ),
      )
      .orderBy(asc(messages.createdAt));

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
    const lastInboundAt = usable[usable.length - 1].createdAt;

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
        .set({ aiLastProcessedInboundAt: lastInboundAt })
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
      .set({ aiLastProcessedInboundAt: lastInboundAt, controlledBy: "ai" })
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
