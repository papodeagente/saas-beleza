"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import {
  type ConnectionView,
  disconnectConnection,
  disconnectDevice,
  getConnection,
  refreshConnectionStatus,
  rotateWebhookToken,
  saveConnection,
  startPairing,
} from "@/server/services/whatsapp-connection-service";

export type ConnectionResult =
  | { ok: true; connection: ConnectionView }
  | { ok: false; error: string };

const saveSchema = z.object({
  name: z.string().trim().max(60).optional(),
  baseUrl: z.string().trim().min(4, "Informe a URL do servidor uazapi."),
  instanceToken: z.string().trim().optional(),
});

/**
 * Salva a conexão e valida contra a uazapi antes de gravar.
 *
 * Validar aqui, e não no primeiro uso, é o que evita o pior modo de falha
 * possível: token errado, tudo parecendo certo na tela, e a descoberta só
 * acontecendo quando um cliente escreve e ninguém responde.
 */
export async function saveConnectionAction(input: unknown): Promise<ConnectionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = saveSchema.parse(input);
    const connection = await saveConnection(ctx, data);
    revalidatePath("/whatsapp");
    return { ok: true, connection };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

const pairingSchema = z.object({
  phone: z.string().trim().max(20).optional(),
});

/**
 * Pede à uazapi o código de pareamento.
 *
 * Sem número devolve o QR; com número, o código de oito dígitos. A tela decide
 * qual pedir, mas o caminho é o mesmo.
 */
export async function startPairingAction(input: unknown): Promise<ConnectionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const data = pairingSchema.parse(input ?? {});
    const connection = await startPairing(ctx, { phone: data.phone || undefined });
    revalidatePath("/whatsapp");
    return { ok: true, connection };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

/**
 * Estado atual do pareamento, para a tela acompanhar sem recarregar.
 *
 * Lê do banco em vez de perguntar à uazapi a cada segundo: o QR renovado chega
 * por webhook, e a confirmação de conexão também.
 */
export async function pairingStateAction(): Promise<ConnectionView | null> {
  const ctx = await requireSession();
  return getConnection(ctx);
}

/** Logout do aparelho na uazapi. Voltar a receber mensagem exige parear de novo. */
export async function disconnectDeviceAction(): Promise<ConnectionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const connection = await disconnectDevice(ctx);
    revalidatePath("/whatsapp");
    return { ok: true, connection };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describe(error) };
  }
}

export async function refreshStatusAction(): Promise<ConnectionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const connection = await refreshConnectionStatus(ctx);
    revalidatePath("/whatsapp");
    return { ok: true, connection };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function rotateWebhookAction(): Promise<ConnectionResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const connection = await rotateWebhookToken(ctx);
    revalidatePath("/whatsapp");
    return { ok: true, connection };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function disconnectAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await disconnectConnection(ctx);
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function getConnectionAction(): Promise<ConnectionView | null> {
  const ctx = await requireSession();
  return getConnection(ctx);
}

/** Erro da uazapi vira instrução: o texto tem que dizer o que fazer a seguir. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "Não foi possível concluir.";
  const message = error.message;
  if (message === "FORBIDDEN") return "Só administradores podem mudar a conexão.";
  if (message.includes("401")) return "Token recusado pela uazapi. Confira o token da instância.";
  if (message.includes("404")) return "A uazapi não encontrou essa instância nesse servidor. Confira a URL.";
  if (message.includes("fetch") || message.includes("ENOTFOUND") || message.includes("ECONNREFUSED")) {
    return "Não consegui falar com esse servidor. Confira a URL e se ele está no ar.";
  }
  return message;
}
