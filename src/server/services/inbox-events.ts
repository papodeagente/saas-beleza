import "server-only";
import { getRedis } from "@/server/queues/redis";

export type InboxEvent = {
  type: "message" | "status" | "reaction" | "deleted";
  conversationId?: number;
};

export function inboxChannel(organizationId: number): string {
  return `inbox:events:${organizationId}`;
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
  const redis = getRedis();
  if (!redis) return;
  await redis.publish(inboxChannel(organizationId), JSON.stringify(event)).catch((error) => {
    console.warn(
      "[inbox realtime] evento não publicado:",
      error instanceof Error ? error.message : error,
    );
  });
}
