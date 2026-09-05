"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/server/platform-auth";
import {
  PlatformAdminError,
  grantPlatformAdmin,
  revokePlatformAdmin,
} from "@/server/services/platform-admins";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

function fail(error: unknown): AdminResult {
  if (error instanceof PlatformAdminError) return { ok: false, error: error.message };
  console.error(error);
  return { ok: false, error: "Não foi possível concluir a ação. Tente de novo." };
}

const grantSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
});

export async function grantAction(input: unknown): Promise<AdminResult> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    // Só quem já administra a plataforma pode promover outra pessoa.
    const ctx = await requirePlatformAdmin();
    const name = await grantPlatformAdmin(ctx, parsed.data.email);
    revalidatePath("/admin/administradores");
    return { ok: true, message: `${name} agora administra a plataforma.` };
  } catch (error) {
    return fail(error);
  }
}

const revokeSchema = z.object({ userId: z.number().int().positive() });

export async function revokeAction(input: unknown): Promise<AdminResult> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Acesso inválido." };

  try {
    const ctx = await requirePlatformAdmin();
    const name = await revokePlatformAdmin(ctx, parsed.data.userId);
    revalidatePath("/admin/administradores");
    return { ok: true, message: `${name} não administra mais a plataforma.` };
  } catch (error) {
    return fail(error);
  }
}
