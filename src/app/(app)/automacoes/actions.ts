"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
} from "@/server/services/automation-service";

const trigger = z.enum(["appointment_created", "before_appointment", "appointment_day", "after_appointment", "after_purchase"]);

export type AutomationActionState = { ok: boolean; message: string };

export async function createAutomationAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = z
      .object({
        name: z.string().trim().min(3, "Informe um nome para a automação.").max(80),
        trigger,
        daysOffset: z.coerce.number().int().min(0).max(365),
        sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido."),
        messageTemplate: z.string().trim().min(10, "Escreva a mensagem que será enviada.").max(1500),
      })
      .parse(Object.fromEntries(formData));
    await createAutomationRule(ctx, { ...data, active: true });
    revalidatePath("/automacoes");
    return { ok: true, message: "Automação criada e ativada." };
  } catch (error) {
    console.error("[automação] falha ao criar regra:", error);
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Revise os campos." };
    return { ok: false, message: "Não foi possível criar a automação. Tente novamente." };
  }
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
