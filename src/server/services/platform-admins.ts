import "server-only";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers, organizations, platformAdmins, users } from "@/db/schema";
import type { PlatformContext } from "@/server/platform-auth";

/**
 * Quem administra o SaaS.
 *
 * Conceder este acesso é a ação mais consequente do produto: um administrador
 * de plataforma enxerga TODAS as clínicas, o faturamento inteiro e pode
 * suspender qualquer conta. Por isso três travas:
 *
 * 1. Só usuário que já existe pode ser promovido — não se cria conta por aqui.
 * 2. Ninguém revoga o próprio acesso (erro clássico que tranca a pessoa fora).
 * 3. Nunca é possível remover o último administrador — sem ele não sobra
 *    ninguém capaz de conceder de volta, e o painel fica inacessível para
 *    sempre sem intervenção no banco.
 */

export class PlatformAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type PlatformAdminRow = {
  userId: number;
  name: string;
  email: string;
  grantedAt: Date;
  grantedByName: string | null;
  /** Clínicas onde essa pessoa também tem acesso comum. */
  clinics: string[];
};

export async function listPlatformAdmins(_ctx: PlatformContext): Promise<PlatformAdminRow[]> {
  const grantedBy = db.select({ id: users.id, name: users.name }).from(users).as("granted_by");

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      grantedAt: platformAdmins.createdAt,
      grantedByName: grantedBy.name,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .leftJoin(grantedBy, eq(grantedBy.id, platformAdmins.grantedByUserId))
    .orderBy(asc(platformAdmins.createdAt));

  if (rows.length === 0) return [];

  const memberships = await db
    .select({ userId: organizationMembers.userId, clinic: organizations.name })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId));

  const byUser = new Map<number, string[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push(m.clinic);
    byUser.set(m.userId, list);
  }

  return rows.map((row) => ({ ...row, clinics: byUser.get(row.userId) ?? [] }));
}

/** Usuário existente, encontrado pelo e-mail. Não cria conta. */
export async function grantPlatformAdmin(ctx: PlatformContext, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!user) {
    throw new PlatformAdminError(
      "Não existe usuário com esse e-mail. A pessoa precisa ter conta no sistema antes de virar administradora da plataforma.",
      "USER_NOT_FOUND",
    );
  }

  const [already] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, user.id))
    .limit(1);
  if (already) {
    throw new PlatformAdminError(`${user.name} já administra a plataforma.`, "ALREADY_ADMIN");
  }

  await db.insert(platformAdmins).values({ userId: user.id, grantedByUserId: ctx.userId });
  return user.name;
}

export async function revokePlatformAdmin(ctx: PlatformContext, userId: number): Promise<string> {
  if (userId === ctx.userId) {
    throw new PlatformAdminError(
      "Você não pode remover o próprio acesso. Peça a outra pessoa com acesso à plataforma.",
      "CANNOT_REVOKE_SELF",
    );
  }

  const [{ total }] = await db.select({ total: count() }).from(platformAdmins);
  if (total <= 1) {
    throw new PlatformAdminError(
      "Este é o último acesso à plataforma. Removê-lo deixaria o painel inacessível.",
      "LAST_ADMIN",
    );
  }

  const [target] = await db
    .select({ name: users.name })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  if (!target) throw new PlatformAdminError("Acesso não encontrado.", "NOT_FOUND");

  await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
  return target.name;
}
