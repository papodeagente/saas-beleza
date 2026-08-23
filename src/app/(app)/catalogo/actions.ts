"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { products, professionalServices, professionals, resources, serviceCategories, services } from "@/db/schema";
import { requireRole, requireSession } from "@/server/auth";

export type CatalogResult = { ok: true } | { ok: false; error: string; field?: string };

function invalid(parsed: z.ZodSafeParseError<unknown>): CatalogResult {
  const issue = parsed.error.issues[0];
  return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
}

async function categoryIdFor(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  categoryName: string,
): Promise<number | null> {
  const name = categoryName.trim();
  if (!name) return null;
  const [existing] = await tx.select({ id: serviceCategories.id }).from(serviceCategories).where(and(
    eq(serviceCategories.organizationId, organizationId),
    sql`lower(${serviceCategories.name}) = lower(${name})`,
  )).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(serviceCategories).values({ organizationId, name }).returning({ id: serviceCategories.id });
  return created.id;
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço."),
  categoryName: z.string().trim().max(80),
  description: z.string().trim().max(500).transform((v) => v || null),
  durationMin: z.number().int().min(5, "A duração mínima é 5 minutos.").max(720),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  commissionPct: z.number().min(0).max(100).nullable(),
  returnIntervalDays: z.number().int().min(1).max(365).nullable(),
  requiredResourceType: z.enum(["room", "cabin", "equipment"]).nullable(),
  onlineBooking: z.boolean(),
  professionalIds: z.array(z.number().int().positive()),
});

export async function createServiceAction(input: unknown): Promise<CatalogResult> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const validProfessionals = parsed.data.professionalIds.length
      ? await db.select({ id: professionals.id }).from(professionals).where(and(
          eq(professionals.organizationId, ctx.organizationId),
          inArray(professionals.id, parsed.data.professionalIds),
        ))
      : [];
    if (validProfessionals.length !== new Set(parsed.data.professionalIds).size) {
      return { ok: false, error: "Um dos profissionais selecionados é inválido.", field: "professionalIds" };
    }
    if (parsed.data.onlineBooking && validProfessionals.length === 0) {
      return {
        ok: false,
        error: "Escolha pelo menos um profissional para disponibilizar este serviço na agenda online.",
        field: "professionalIds",
      };
    }
    if (parsed.data.requiredResourceType) {
      const [availableResource] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, ctx.organizationId),
            eq(resources.type, parsed.data.requiredResourceType),
            eq(resources.active, true),
          ),
        )
        .limit(1);
      if (!availableResource) {
        const label = {
          room: "sala",
          cabin: "cabine",
          equipment: "equipamento",
        }[parsed.data.requiredResourceType];
        return {
          ok: false,
          error: `Cadastre ao menos um recurso ativo do tipo ${label} em Gestão ou selecione “Nenhum”.`,
          field: "requiredResourceType",
        };
      }
    }
    await db.transaction(async (tx) => {
      const categoryId = await categoryIdFor(tx, ctx.organizationId, parsed.data.categoryName);
      const [service] = await tx.insert(services).values({
        organizationId: ctx.organizationId,
        categoryId,
        name: parsed.data.name,
        description: parsed.data.description,
        durationMin: parsed.data.durationMin,
        priceCents: parsed.data.priceCents,
        costCents: parsed.data.costCents,
        commissionBps: parsed.data.commissionPct === null ? null : Math.round(parsed.data.commissionPct * 100),
        returnIntervalDays: parsed.data.returnIntervalDays,
        requiredResourceType: parsed.data.requiredResourceType,
        onlineBooking: parsed.data.onlineBooking,
      }).returning({ id: services.id });
      if (validProfessionals.length) {
        await tx.insert(professionalServices).values(validProfessionals.map((professional) => ({
          organizationId: ctx.organizationId,
          professionalId: professional.id,
          serviceId: service.id,
        })));
      }
    });
    revalidatePath("/catalogo");
    revalidatePath("/gestao");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível cadastrar o serviço." };
  }
}

const productSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto."),
  categoryName: z.string().trim().max(80),
  description: z.string().trim().max(500).transform((v) => v || null),
  sku: z.string().trim().max(80).transform((v) => v || null),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  stockQty: z.number().int().min(0),
});

export async function createProductAction(input: unknown): Promise<CatalogResult> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed);
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await db.transaction(async (tx) => {
      const categoryId = await categoryIdFor(tx, ctx.organizationId, parsed.data.categoryName);
      await tx.insert(products).values({
        organizationId: ctx.organizationId,
        categoryId,
        name: parsed.data.name,
        description: parsed.data.description,
        sku: parsed.data.sku,
        priceCents: parsed.data.priceCents,
        costCents: parsed.data.costCents,
        stockQty: parsed.data.stockQty,
      });
    });
    revalidatePath("/catalogo");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível cadastrar o produto." };
  }
}
