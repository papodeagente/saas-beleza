import "server-only";
import { EventEmitter } from "node:events";
import IORedis from "ioredis";
import { getRedis } from "@/server/queues/redis";

export type InboxEvent = {
  type: "message" | "status" | "reaction" | "deleted" | "assignment";
  conversationId?: number;
};

export function inboxChannel(organizationId: number): string {
  return `inbox:events:${organizationId}`;
}

/**
 * Barramento local, usado quando não há Redis.
 *
 * Sem ele, um ambiente sem REDIS_URL (o desenvolvimento, tipicamente) ficava
 * com o tempo real MUDO em silêncio: o webhook publicava no vazio, a rota SSE
 * respondia 503 e a tela caía no poll de 30 segundos — mais lento que o
 * comportamento antigo. Num processo único, um EventEmitter entrega exatamente
 * a mesma semântica do pub/sub; o Redis continua sendo o caminho de produção
 * porque é o único que atravessa instâncias.
 *
 * Guardado em globalThis pelo mesmo motivo dos workers: em desenvolvimento o
 * módulo é recarregado a cada edição e cada recarga criaria um barramento novo,
 * órfão dos assinantes antigos.
 */
declare global {
  var __inboxLocalBus: EventEmitter | undefined;
}

export function getLocalInboxBus(): EventEmitter {
  if (!globalThis.__inboxLocalBus) {
    const bus = new EventEmitter();
    // Cada aba aberta do Inbox é um assinante; o teto padrão de 10 dispararia
    // aviso com meia dúzia de atendentes de duas telas cada.
    bus.setMaxListeners(200);
    globalThis.__inboxLocalBus = bus;
  }
  return globalThis.__inboxLocalBus;
}

/**
 * A gravação no banco é a fonte da verdade. O evento apenas avisa as telas
 * abertas que já podem reler essa verdade, portanto uma indisponibilidade
 * momentânea do Redis nunca pode fazer o webhook falhar.
 */
export async function publishInboxEvent(
  organizationId: number,
  event: InboxEvent,
): Promise<void> {
  const payload = JSON.stringify(event);
  const redis = getRedis();
  if (redis) {
    await redis.publish(inboxChannel(organizationId), payload).catch((error) => {
      console.warn(
        "[inbox realtime] evento não publicado:",
        error instanceof Error ? error.message : error,
      );
    });
    return;
  }
  getLocalInboxBus().emit(inboxChannel(organizationId), payload);
}

/**
 * Assinante ÚNICO por processo, com distribuição em memória.
 *
 * A rota SSE abria uma conexão IORedis POR ABA: dez atendentes com duas telas
 * cada eram vinte conexões ao Redis para receber exatamente os mesmos eventos.
 * Aqui existe uma conexão só, que escuta todos os canais de organização por
 * padrão de nome e reparte localmente para quem estiver ouvindo.
 *
 * Guardado em globalThis pelo mesmo motivo do barramento local: em
 * desenvolvimento o módulo recarrega a cada edição, e cada recarga abriria
 * outra conexão órfã.
 */
declare global {
  var __inboxRedisSub: { client: IORedis; bus: EventEmitter } | undefined;
}

function getSharedRedisSubscriber(url: string): { bus: EventEmitter } | null {
  if (globalThis.__inboxRedisSub) return globalThis.__inboxRedisSub;
  try {
    const client = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    const bus = new EventEmitter();
    bus.setMaxListeners(500);
    client.on("error", (error) => {
      console.warn("[inbox realtime] assinante compartilhado:", error.message);
    });
    client.on("pmessage", (_pattern, channel, message) => bus.emit(channel, message));
    // `psubscribe` e não uma assinatura por organização: o processo atende
    // várias contas e reassinar a cada aba nova traria de volta o custo que
    // esta função existe para eliminar.
    void client.psubscribe("inbox:events:*");
    globalThis.__inboxRedisSub = { client, bus };
    return globalThis.__inboxRedisSub;
  } catch (error) {
    console.warn(
      "[inbox realtime] assinante compartilhado não subiu:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Onde a rota SSE escuta, sem precisar saber se veio do Redis ou daqui de
 * dentro. Devolve a função que cancela a escuta.
 */
export function subscribeInbox(
  organizationId: number,
  onEvent: (payload: string) => void,
): () => void {
  const channel = inboxChannel(organizationId);
  const url = process.env.REDIS_URL;
  const bus = url ? getSharedRedisSubscriber(url)?.bus : getLocalInboxBus();
  if (!bus) return () => {};
  bus.on(channel, onEvent);
  return () => {
    bus.off(channel, onEvent);
  };
}
