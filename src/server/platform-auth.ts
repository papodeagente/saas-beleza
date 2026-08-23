import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { platformAdmins, sessions, users } from "@/db/schema";
import { SESSION_COOKIE } from "@/server/auth";

/**
 * Acesso ao painel da plataforma.
 *
 * REGRA INEGOCIÁVEL: ser dono ou administrador de uma clínica NÃO dá acesso
 * aqui. O papel de plataforma vive numa tabela própria (`platform_admins`) e é
 * concedido explicitamente. Um tenant comprometido não vira acesso ao SaaS
 * inteiro.
 *
 * Este contexto também não carrega `organizationId`: quem opera a plataforma
 * enxerga todas as contas, então qualquer consulta feita a partir daqui é
 * cross-tenant por definição e nunca deve reaproveitar os serviços de tenant.
 */
export type PlatformContext = {
  userId: number;
  userName: string;
  userEmail: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getPlatformSession(): Promise<PlatformContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0] ?? null;
}

export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const ctx = await getPlatformSession();
  if (!ctx) throw new Error("NOT_PLATFORM_ADMIN");
  return ctx;
}

export async function isPlatformAdmin(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return Boolean(row);
}
