import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { organizationMembers, organizations, sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "lumina_session";
const SESSION_DAYS = 30;

export type Role = "owner" | "admin" | "staff" | "professional";

/**
 * Contexto de tenant. É a ÚNICA fonte de organizationId da aplicação —
 * deriva da sessão no servidor e nunca de payload do cliente.
 */
export type TenantContext = {
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  timezone: string;
  userId: number;
  userName: string;
  userEmail: string;
  role: Role;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Contexto da sessão atual, ou null. Não redireciona. */
export async function getSession(): Promise<TenantContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      role: organizationMembers.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      timezone: organizations.timezone,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0] ?? null;
}

/** Contexto da sessão. Lança se não autenticado — use em toda action/página privada. */
export async function requireSession(): Promise<TenantContext> {
  const ctx = await getSession();
  if (!ctx) throw new Error("UNAUTHENTICATED");
  return ctx;
}

const RANK: Record<Role, number> = { professional: 0, staff: 1, admin: 2, owner: 3 };

export function requireRole(ctx: TenantContext, min: Role): void {
  if (RANK[ctx.role] < RANK[min]) throw new Error("FORBIDDEN");
}
