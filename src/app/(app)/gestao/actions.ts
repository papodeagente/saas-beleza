"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateDayRanges } from "@/domain/working-hours";
import { db } from "@/db";
import {
  branches,
  organizationMemberBranches,
  organizations,
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
import { BranchError, createBranch, updateBranch } from "@/server/services/branch-service";
import { CepError, apenasDigitos, buscarCep } from "@/server/services/location-service";
import { ProfessionalError, deleteProfessional, updateProfessional } from "@/server/services/professional-service";

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
  // Endereço estruturado. Opcional inteiro: a maioria da base não tem nada
  // disto, e exigir agora quebraria o cadastro de quem só quer marcar horário.
  postalCode: z.string().trim().max(9).optional().transform((v) => (v ? apenasDigitos(v) : null)),
  street: z.string().trim().max(200).optional().transform((v) => v || null),
  number: z.string().trim().max(20).optional().transform((v) => v || null),
  complement: z.string().trim().max(80).optional().transform((v) => v || null),
  district: z.string().trim().max(120).optional().transform((v) => v || null),
  city: z.string().trim().max(120).optional().transform((v) => v || null),
  uf: z.string().trim().length(2).optional().or(z.literal("")).transform((v) => v || null),
  ibgeCode: z.number().int().positive().optional().nullable(),
});

function branchFailure(error: unknown): CadastroResult {
  if (error instanceof BranchError) return { ok: false, error: error.message, field: error.field };
  return failure(error);
}

export async function createBranchAction(input: unknown): Promise<CadastroResult> {
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await createBranch(ctx, parsed.data);
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    return branchFailure(error);
  }
}

const updateBranchSchema = branchSchema.extend({
  branchId: z.number().int().positive(),
  active: z.boolean().optional(),
});

/**
 * Editar unidade — o que não existia.
 *
 * Até aqui `gestao/actions.ts` só sabia CRIAR. Uma clínica que digitasse o
 * endereço errado convivia com ele para sempre, e isso deixou de ser incômodo
 * para virar bloqueio no dia em que o endereço passou a decidir se o salão
 * aparece na busca por cidade.
 */
export async function updateBranchAction(input: unknown): Promise<CadastroResult> {
  const parsed = updateBranchSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const { branchId, ...campos } = parsed.data;
    await updateBranch(ctx, branchId, campos);
    revalidatePath("/gestao");
    revalidatePath("/manicures");
    return { ok: true };
  } catch (error) {
    return branchFailure(error);
  }
}

export type CepResult =
  | { ok: true; endereco: Awaited<ReturnType<typeof buscarCep>> }
  | { ok: false; error: string };

/**
 * Busca de CEP.
 *
 * Sai daqui e não do navegador de propósito: o ViaCEP não publica CORS
 * garantido, e chamar de dentro do servidor deixa a chave de vazão, o prazo e o
 * tratamento de erro num lugar só. É `requireSession` porque é ferramenta do
 * painel, não rota aberta que qualquer um usa como proxy de CEP.
 */
export async function buscarCepAction(cep: unknown): Promise<CepResult> {
  const parsed = z.string().safeParse(cep);
  if (!parsed.success) return { ok: false, error: "CEP inválido." };
  try {
    await requireSession();
    return { ok: true, endereco: await buscarCep(parsed.data) };
  } catch (error) {
    if (error instanceof CepError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Não conseguimos consultar o CEP agora." };
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

const professionalUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(2, "Informe o nome do profissional."),
  specialty: z.string().trim().max(120).transform((v) => v || null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida."),
  commissionPct: z.number().min(0).max(100),
  active: z.boolean(),
  serviceIds: z.array(z.number().int().positive()),
});

function professionalFailure(error: unknown): CadastroResult {
  if (error instanceof ProfessionalError) return { ok: false, error: error.message, field: error.field };
  return failure(error);
}

export async function updateProfessionalAction(input: unknown): Promise<CadastroResult> {
  const parsed = professionalUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const { id, ...campos } = parsed.data;
    await updateProfessional(ctx, id, campos);
    revalidatePath("/gestao");
    revalidatePath("/catalogo");
    revalidatePath("/agenda");
    return { ok: true };
  } catch (error) {
    return professionalFailure(error);
  }
}

export type DeleteProfessionalResult =
  | { ok: true; deactivated: false }
  | { ok: true; deactivated: true; reason: string }
  | { ok: false; error: string };

export async function deleteProfessionalAction(input: unknown): Promise<DeleteProfessionalResult> {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Profissional inválido." };
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const [nome] = await db.select({ name: professionals.name }).from(professionals).where(and(
      eq(professionals.id, parsed.data.id),
      eq(professionals.organizationId, ctx.organizationId),
    )).limit(1);
    const { deactivated } = await deleteProfessional(ctx, parsed.data.id);
    revalidatePath("/gestao");
    revalidatePath("/catalogo");
    revalidatePath("/agenda");
    if (deactivated) {
      return {
        ok: true,
        deactivated: true,
        reason: `${nome?.name ?? "Profissional"} tem atendimentos ou comissões no histórico — foi desativado(a) em vez de excluído(a), para preservar esse histórico.`,
      };
    }
    return { ok: true, deactivated: false };
  } catch (error) {
    if (error instanceof ProfessionalError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Não foi possível excluir. Tente novamente." };
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

// ---------------------------------------------------------------------------
// Vitrine pública — o marketplace de manicures
// ---------------------------------------------------------------------------

const vitrineSchema = z.object({
  /** O interruptor. Nasce desligado e só a clínica liga. */
  listed: z.boolean(),
  bio: z.string().trim().max(280, "Máximo de 280 caracteres.").transform((v) => v || null),
  whatsapp: z.string().trim().transform((v) => (v ? normalizePhone(v) : null)),
  instagram: z
    .string()
    .trim()
    .max(60)
    // Aceita "@nome", "nome" ou a URL colada do navegador — quem cadastra copia
    // de onde estiver, e recusar por causa do formato é atrito à toa.
    .transform((v) => v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, ""))
    .transform((v) => v || null),
});

/**
 * Liga ou desliga o salão no diretório, e guarda como ele se apresenta.
 *
 * O `revalidatePath("/manicures")` existe porque o diretório é cacheado: sem
 * ele a clínica liga o interruptor, vai conferir e não se encontra — e conclui
 * que não funcionou.
 */
export async function salvarVitrineAction(input: unknown): Promise<CadastroResult> {
  const parsed = vitrineSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const { listed, bio, whatsapp, instagram } = parsed.data;

    const [antes] = await db
      .select({ listed: organizations.marketplaceListed })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId))
      .limit(1);

    await db
      .update(organizations)
      .set({
        marketplaceListed: listed,
        marketplaceBio: bio,
        marketplaceWhatsapp: whatsapp,
        marketplaceInstagram: instagram,
        // Carimba só na virada de desligado para ligado: é a data de entrada no
        // diretório, não a de qualquer salvamento.
        ...(listed && !antes?.listed ? { marketplaceListedAt: new Date() } : {}),
      })
      .where(eq(organizations.id, ctx.organizationId));

    revalidatePath("/gestao");
    revalidatePath("/manicures");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
