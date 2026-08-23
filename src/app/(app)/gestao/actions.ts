"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateDayRanges } from "@/domain/working-hours";
import { db } from "@/db";
import {
  branches,
  organizationMemberBranches,
  organizationMembers,
  professionalServices,
  professionalWorkingHours,
  professionals,
  resources,
  services,
  users,
} from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { hashPassword, requireRole, requireSession } from "@/server/auth";

export type CadastroResult = { ok: true } | { ok: false; error: string; field?: string };

function validationError(parsed: z.ZodSafeParseError<unknown>): CadastroResult {
  const issue = parsed.error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
}

function failure(error: unknown): CadastroResult {
  console.error(error);
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23505") return { ok: false, error: "Já existe um cadastro com esses dados." };
  return { ok: false, error: "Não foi possível salvar. Confira os dados e tente novamente." };
}

const branchSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da unidade."),
  address: z.string().trim().max(300).transform((v) => v || null),
  phone: z.string().trim().transform((v) => (v ? normalizePhone(v) : null)),
});

export async function createBranchAction(input: unknown): Promise<CadastroResult> {
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await db.insert(branches).values({ organizationId: ctx.organizationId, ...parsed.data });
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

const resourceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do recurso."),
  type: z.enum(["room", "cabin", "equipment"]),
  branchId: z.number().int().positive(),
});

export async function createResourceAction(input: unknown): Promise<CadastroResult> {
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, parsed.data.branchId), eq(branches.organizationId, ctx.organizationId)))
      .limit(1);
    if (!branch) return { ok: false, error: "Unidade inválida.", field: "branchId" };
    await db.insert(resources).values({ organizationId: ctx.organizationId, ...parsed.data });
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

const professionalSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do profissional."),
  specialty: z.string().trim().max(120).transform((v) => v || null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."),
  commissionPct: z.number().min(0).max(100),
  branchId: z.number().int().positive(),
  ranges: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string(),
    endTime: z.string(),
  })).min(1, "Cadastre ao menos um período de atendimento.").max(42),
  serviceIds: z.array(z.number().int().positive()),
});

export async function createProfessionalAction(input: unknown): Promise<CadastroResult> {
  const parsed = professionalSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  for (let weekday = 0; weekday <= 6; weekday++) {
    const message = validateDayRanges(parsed.data.ranges.filter((range) => range.weekday === weekday));
    if (message) return { ok: false, error: message, field: "ranges" };
  }
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const [branch] = await db.select({ id: branches.id }).from(branches).where(and(
      eq(branches.id, parsed.data.branchId),
      eq(branches.organizationId, ctx.organizationId),
      eq(branches.active, true),
    )).limit(1);
    if (!branch) return { ok: false, error: "Unidade inválida.", field: "branchId" };

    const validServices = parsed.data.serviceIds.length
      ? await db.select({ id: services.id }).from(services).where(and(
          eq(services.organizationId, ctx.organizationId),
          inArray(services.id, parsed.data.serviceIds),
        ))
      : [];
    if (validServices.length !== parsed.data.serviceIds.length) {
      return { ok: false, error: "Um dos serviços selecionados é inválido.", field: "serviceIds" };
    }

    await db.transaction(async (tx) => {
      const [professional] = await tx.insert(professionals).values({
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        specialty: parsed.data.specialty,
        color: parsed.data.color,
        commissionBps: Math.round(parsed.data.commissionPct * 100),
      }).returning({ id: professionals.id });
      await tx.insert(professionalWorkingHours).values(parsed.data.ranges.map((range) => ({
        organizationId: ctx.organizationId,
        professionalId: professional.id,
        branchId: parsed.data.branchId,
        weekday: range.weekday,
        startTime: range.startTime,
        endTime: range.endTime,
      })));
      if (validServices.length) {
        await tx.insert(professionalServices).values(validServices.map((service) => ({
          organizationId: ctx.organizationId,
          professionalId: professional.id,
          serviceId: service.id,
        })));
      }
    });
    revalidatePath("/gestao");
    revalidatePath("/catalogo");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

const memberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do usuário."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha temporária precisa ter ao menos 8 caracteres."),
  role: z.enum(["admin", "staff", "professional"]),
  branchIds: z.array(z.number().int().positive()).min(1, "Selecione ao menos uma unidade."),
});

export async function createMemberAction(input: unknown): Promise<CadastroResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const validBranches = await db.select({ id: branches.id }).from(branches).where(and(
      eq(branches.organizationId, ctx.organizationId),
      inArray(branches.id, parsed.data.branchIds),
      eq(branches.active, true),
    ));
    if (validBranches.length !== new Set(parsed.data.branchIds).size) {
      return { ok: false, error: "Uma das unidades selecionadas é inválida.", field: "branchIds" };
    }
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) return { ok: false, error: "Este e-mail já pertence a outro usuário.", field: "email" };

    const passwordHash = await hashPassword(parsed.data.password);
    await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
      }).returning({ id: users.id });
      await tx.insert(organizationMembers).values({
        organizationId: ctx.organizationId,
        userId: user.id,
        role: parsed.data.role,
      });
      await tx.insert(organizationMemberBranches).values(validBranches.map((branch) => ({
        organizationId: ctx.organizationId,
        userId: user.id,
        branchId: branch.id,
      })));
    });
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
