"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
} from "@/server/services/automation-service";

const trigger = z.enum(["before_appointment", "appointment_day", "after_appointment", "after_purchase"]);

export async function createAutomationAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const data = z
    .object({
      name: z.string().trim().min(3).max(80),
      trigger,
      daysOffset: z.coerce.number().int().min(0).max(365),
      sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      messageTemplate: z.string().trim().min(10).max(1500),
    })
    .parse(Object.fromEntries(formData));
  await createAutomationRule(ctx, { ...data, active: true });
  revalidatePath("/automacoes");
}

export async function toggleAutomationAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const data = z
    .object({ id: z.coerce.number().int().positive(), active: z.enum(["true", "false"]) })
    .parse(Object.fromEntries(formData));
  await setAutomationRuleActive(ctx, data.id, data.active === "true");
  revalidatePath("/automacoes");
}

export async function deleteAutomationAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(Object.fromEntries(formData));
  await deleteAutomationRule(ctx, id);
  revalidatePath("/automacoes");
}

