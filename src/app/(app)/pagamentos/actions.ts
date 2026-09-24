"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/server/auth";
import { AsaasAuthError, AsaasError } from "@/server/payments/asaas";
import {
  type ContaAsaasNaTela,
  conectarAsaas,
  contaDaClinica,
  desconectarAsaas,
  reconferirPix,
  salvarRegraDeCobranca,
} from "@/server/services/asaas-account-service";

export type ContaSerializada = Omit<ContaAsaasNaTela, "conferidaEm"> & { conferidaEm: string | null };

export type ContaResult =
  | { ok: true; conta: ContaSerializada | null }
  | { ok: false; error: string };

function serializar(conta: ContaAsaasNaTela | null): ContaSerializada | null {
  return conta ? { ...conta, conferidaEm: conta.conferidaEm?.toISOString() ?? null } : null;
}

/**
 * Traduz a falha do Asaas para o que a dona da clínica pode resolver.
 *
 * Devolver "Asaas POST /webhooks devolveu 400" para quem administra um salão
 * não ajuda ninguém: ou a mensagem diz o que fazer, ou vira chamado de
 * suporte.
 */
function explicar(erro: unknown): string {
  if (erro instanceof AsaasAuthError) {
    return "O Asaas recusou esta chave. Gere uma nova em Integrações, no painel do Asaas, e cole aqui.";
  }
  if (erro instanceof AsaasError) {
    return "Não consegui falar com o Asaas agora. Tente de novo em alguns minutos.";
  }
  if (erro instanceof Error) return erro.message;
  return "Não foi possível concluir.";
}

const chaveSchema = z.object({ chave: z.string().trim().min(10).max(400) });

export async function conectarAsaasAction(input: unknown): Promise<ContaResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const { chave } = chaveSchema.parse(input);
    const conta = await conectarAsaas(ctx, chave);
    revalidatePath("/pagamentos");
    return { ok: true, conta: serializar(conta) };
  } catch (erro) {
    console.error(erro);
    return { ok: false, error: explicar(erro) };
  }
}

export async function desconectarAsaasAction(): Promise<ContaResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    await desconectarAsaas(ctx);
    revalidatePath("/pagamentos");
    return { ok: true, conta: null };
  } catch (erro) {
    console.error(erro);
    return { ok: false, error: explicar(erro) };
  }
}

const regraSchema = z.object({
  exigirPagamento: z.boolean(),
  percentual: z.number().int().min(10).max(100),
  minutosDeReserva: z.number().int().min(10).max(1440),
});

export async function salvarRegraAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const regra = regraSchema.parse(input);
    await salvarRegraDeCobranca(ctx, regra);
    revalidatePath("/pagamentos");
    revalidatePath("/agenda");
    return { ok: true };
  } catch (erro) {
    console.error(erro);
    return { ok: false, error: explicar(erro) };
  }
}

/**
 * Reconfere se a conta já tem chave PIX.
 *
 * A tela não guarda a chave de API, então sem isto a dona que cadastrasse a
 * chave PIX depois de conectar teria de buscar a chave de API no Asaas de novo
 * só para liberar o PIX.
 */
export async function reconferirPixAction(): Promise<ContaResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    const conta = await reconferirPix(ctx);
    revalidatePath("/pagamentos");
    return { ok: true, conta: serializar(conta) };
  } catch (erro) {
    console.error(erro);
    return { ok: false, error: explicar(erro) };
  }
}

/** Reconsulta a conta — usada depois de conectar à mão pelo painel do Asaas. */
export async function recarregarContaAction(): Promise<ContaResult> {
  try {
    const ctx = await requireSession();
    requireRole(ctx, "admin");
    return { ok: true, conta: serializar(await contaDaClinica(ctx.organizationId)) };
  } catch (erro) {
    console.error(erro);
    return { ok: false, error: explicar(erro) };
  }
}
