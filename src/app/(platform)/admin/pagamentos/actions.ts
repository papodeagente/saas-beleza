"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { PROVIDER_KINDS, deleteProvider, saveProvider } from "@/server/services/hotmart";

/**
 * Ações da tela de pagamentos.
 *
 * Toda ação começa por `requirePlatformAdmin`: ser dono de uma clínica não abre
 * esta porta, e o guard no layout protege a navegação, não a chamada. Uma
 * server action é um endpoint público — quem souber o id chama direto.
 *
 * O token do webhook entra por aqui e não volta nunca: o serviço guarda o hash
 * e uma dica de quatro dígitos. Por isso o campo vazio significa "mantém o que
 * está lá", e não "apaga" — apagar é uma escolha explícita da tela.
 */

const saveSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  name: z.string().trim().min(2, "Dê um nome ao provedor.").max(60),
  enabled: z.boolean(),
  webhookToken: z.string().trim().max(400).optional(),
  clearWebhookToken: z.boolean().optional(),
});

export type SaveProviderResult = { ok: true } | { ok: false; error: string };

export async function saveProviderAction(input: unknown): Promise<SaveProviderResult> {
  try {
    const ctx = await requirePlatformAdmin();
    const data = saveSchema.parse(input);
    await saveProvider(ctx, data);
    revalidatePath("/admin/pagamentos");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function deleteProviderAction(providerId: number): Promise<SaveProviderResult> {
  try {
    const ctx = await requirePlatformAdmin();
    const result = await deleteProvider(ctx, providerId);
    if (!result.ok) return result;
    revalidatePath("/admin/pagamentos");
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Confira os campos do formulário.";
  }
  if (!(error instanceof Error)) return "Não foi possível salvar.";
  if (error.message === "NOT_PLATFORM_ADMIN") return "Esta área é da plataforma.";
  if (error.message === "TOKEN_REQUIRED") {
    return "Ligar sem o token do webhook não adianta: toda entrega seria recusada. Cole o token antes.";
  }
  return error.message;
}
