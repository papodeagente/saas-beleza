"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";
import { requireSession } from "@/server/auth";
import {
  CustomerError,
  type CustomerInput,
  createCustomer,
  updateCustomer,
} from "@/server/services/customer-service";

export type CustomerResult =
  | { ok: true; customerId: number }
  | { ok: false; error: string; field?: string };

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome completo do cliente."),
  phone: z
    .string()
    .trim()
    .transform((v) => (v ? normalizePhone(v) : ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Informe um celular com DDD.")
    .transform((v) => v || null),
  email: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "E-mail inválido."),
  birthdate: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida."),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null),
  preferredProfessionalId: z.number().int().positive().nullable(),
  preferredBranchId: z.number().int().positive().nullable(),
  consentMarketing: z.boolean(),
});

function fail(error: unknown): CustomerResult {
  if (error instanceof CustomerError) return { ok: false, error: error.message, field: error.field };
  console.error(error);
  return { ok: false, error: "Não foi possível salvar o cliente. Tente de novo." };
}

export async function saveCustomerAction(
  input: unknown,
  customerId?: number,
): Promise<CustomerResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0] ?? "") };
  }

  try {
    const ctx = await requireSession();
    const data = parsed.data as CustomerInput;
    const saved = customerId
      ? await updateCustomer(ctx, customerId, data)
      : await createCustomer(ctx, data);

    revalidatePath("/clientes");
    if (customerId) revalidatePath(`/clientes/${customerId}`);
    return { ok: true, customerId: saved.id };
  } catch (error) {
    return fail(error);
  }
}
