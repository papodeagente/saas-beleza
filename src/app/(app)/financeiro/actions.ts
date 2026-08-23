"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { branches, financialCategories, financialTransactions } from "@/db/schema";
import { requireRole, requireSession } from "@/server/auth";

export type TransactionResult = { ok: true } | { ok: false; error: string; field?: string };

const schema = z.object({
  kind: z.enum(["income", "expense"]),
  description: z.string().trim().min(2, "Informe a descrição."),
  amountCents: z.number().int().positive("Informe um valor maior que zero."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
  status: z.enum(["pending", "paid"]),
  branchId: z.number().int().positive().nullable(),
  categoryName: z.string().trim().max(80),
});

export async function createTransactionAction(input: unknown): Promise<TransactionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
  }
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    if (parsed.data.branchId) {
      const [branch] = await db.select({ id: branches.id }).from(branches).where(and(
        eq(branches.id, parsed.data.branchId), eq(branches.organizationId, ctx.organizationId),
      )).limit(1);
      if (!branch) return { ok: false, error: "Unidade inválida.", field: "branchId" };
    }
    await db.transaction(async (tx) => {
      let categoryId: number | null = null;
      if (parsed.data.categoryName) {
        const [existing] = await tx.select({ id: financialCategories.id }).from(financialCategories).where(and(
          eq(financialCategories.organizationId, ctx.organizationId),
          eq(financialCategories.kind, parsed.data.kind),
          sql`lower(${financialCategories.name}) = lower(${parsed.data.categoryName})`,
        )).limit(1);
        if (existing) categoryId = existing.id;
        else {
          const [created] = await tx.insert(financialCategories).values({ organizationId: ctx.organizationId, name: parsed.data.categoryName, kind: parsed.data.kind }).returning({ id: financialCategories.id });
          categoryId = created.id;
        }
      }
      await tx.insert(financialTransactions).values({
        organizationId: ctx.organizationId,
        branchId: parsed.data.branchId,
        kind: parsed.data.kind,
        status: parsed.data.status,
        description: parsed.data.description,
        amountCents: parsed.data.amountCents,
        dueDate: parsed.data.dueDate,
        paidAt: parsed.data.status === "paid" ? new Date() : null,
        categoryId,
      });
    });
    revalidatePath("/financeiro");
    revalidatePath("/hoje");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Não foi possível criar o lançamento." };
  }
}
