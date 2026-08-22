import "server-only";
import IORedis from "ioredis";

/**
 * Conexão Redis compartilhada.
 *
 * O agente depende dela para três coisas que não podem viver em memória de
 * processo: a fila de turnos, o lock por conversa e os contadores de limite.
 * Sem Redis o agente não responde — e é melhor não responder do que responder
 * duas vezes, que é o que acontece quando duas réplicas processam a mesma
 * conversa sem lock.
 */

declare global {
  var __agentRedis: IORedis | undefined;
}

export function redisAvailable(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!global.__agentRedis) {
    global.__agentRedis = new IORedis(url, {
      // Exigido pelo BullMQ: sem isso, um comando bloqueante falha em vez de esperar.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    global.__agentRedis.on("error", (error) => {
      console.error("[redis] erro de conexão:", error.message);
    });
  }
  return global.__agentRedis;
}

/**
 * Lock de conversa. Enquanto vale, nenhuma outra réplica processa a mesma
 * conversa — é o que impede duas respostas para a mesma mensagem.
 */
export async function acquireConversationLock(conversationId: number, ttlSeconds = 90): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const result = await redis.set(`agent:lock:${conversationId}`, "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function releaseConversationLock(conversationId: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`agent:lock:${conversationId}`).catch(() => {});
}

/** Contador por janela de um minuto. Retorna quantas vezes já ocorreu. */
export async function incrementWindow(key: string, windowSeconds = 60): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const value = await redis.incr(key);
  if (value === 1) await redis.expire(key, windowSeconds);
  return value;
}
