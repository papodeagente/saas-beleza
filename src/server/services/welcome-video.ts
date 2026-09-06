import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { organizations } from "@/db/schema";

/**
 * O vídeo de boas-vindas — mostrado uma vez, na primeira entrada da clínica
 * depois do cadastro (teste grátis ou conta ativada por compra direta).
 *
 * `cache` pelo mesmo motivo de `getAccountAccess`: o layout de (app) já
 * consulta isso em toda navegação, e a marcação de "visto" acontece uma vez
 * só, então vale a pena não repetir a leitura dentro da mesma requisição.
 */
export const getWelcomeVideoSeenAt = cache(async function getWelcomeVideoSeenAt(
  organizationId: number,
): Promise<Date | null> {
  const [row] = await db
    .select({ seenAt: organizations.welcomeVideoSeenAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  return row?.seenAt ?? null;
});

/**
 * Marca como visto — ao terminar o vídeo, ou ao pular. `WHERE ... IS NULL`
 * não é otimização: preserva a primeira data de verdade se o clique chegar
 * em duplicidade (duas abas, duplo clique), em vez de empurrar o carimbo
 * pra frente a cada chamada.
 */
export async function markWelcomeVideoSeen(organizationId: number): Promise<void> {
  await db
    .update(organizations)
    .set({ welcomeVideoSeenAt: new Date() })
    .where(and(eq(organizations.id, organizationId), isNull(organizations.welcomeVideoSeenAt)));
}
