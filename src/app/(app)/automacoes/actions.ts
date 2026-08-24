"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  AutomationRuleConflictError,
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
} from "@/server/services/automation-service";

const trigger = z.enum([
  "appointment_created",
  "before_appointment",
  "appointment_day",
  "after_appointment",
  "after_purchase",
  "birthday_before",
  "birthday_day",
]);

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
    // A recusa por gatilho repetido não é um defeito: é a explicação que evita
    // que a mesma cliente receba a mesma mensagem duas vezes. Ela precisa
    // chegar inteira à tela, e não virar um "tente novamente" genérico.
    if (error instanceof AutomationRuleConflictError) return { ok: false, message: error.message };
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
  try {
    await setAutomationRuleActive(ctx, data.id, data.active === "true");
  } catch (error) {
    /**
     * A tela já desabilita "Ativar" no gatilho ocupado, mas isso é decisão
     * tomada com o estado do último carregamento: duas abas abertas, ou uma
     * aba parada desde antes de a outra regra ser ativada, chegam aqui com o
     * botão liberado. Deixar a recusa subir troca a explicação em português
     * pela tela de erro do aplicativo — pior do que não ter acontecido nada.
     * Revalidar devolve a página já com o botão desabilitado e com a frase que
     * diz qual automação ocupa o gatilho.
     */
    if (!(error instanceof AutomationRuleConflictError)) throw error;
  }
  revalidatePath("/automacoes");
}

export async function deleteAutomationAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(Object.fromEntries(formData));
  await deleteAutomationRule(ctx, id);
  revalidatePath("/automacoes");
}
