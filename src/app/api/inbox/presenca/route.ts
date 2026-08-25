import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/server/auth";
import { getAccountAccess } from "@/server/services/account-access";
import { notifyPresence } from "@/server/services/whatsapp-message-service";

/**
 * O "digitando…" que a cliente vê — fora do canal de server action.
 *
 * POR QUE NÃO É UMA SERVER ACTION: o navegador despacha server actions UMA DE
 * CADA VEZ. Este aviso sai a cada três segundos enquanto a atendente escreve, e
 * cada um custa duas consultas e uma ida à uazapi. Ou seja: a cada três
 * segundos de digitação havia meio segundo de fila ocupada — e o toque na
 * próxima conversa esperava atrás de um aviso de presença que ninguém vê.
 *
 * Aqui ele sai por um canal próprio, em paralelo, e some da conta do clique.
 * Falhar é aceitável por definição: presença não entregue não muda nada do que
 * está gravado.
 */

const corpo = z.object({
  conversationId: z.coerce.number().int().positive(),
  presence: z.enum(["composing", "recording", "paused"]),
});

export async function POST(request: Request) {
  const ctx = await getSession();
  if (!ctx) return new NextResponse(null, { status: 401 });
  try {
    requireRole(ctx, "staff");
  } catch {
    return new NextResponse(null, { status: 403 });
  }
  const acesso = await getAccountAccess(ctx.organizationId);
  if (!acesso.allowed) return new NextResponse(null, { status: 402 });

  const dados = corpo.safeParse(await request.json().catch(() => ({})));
  if (!dados.success) return new NextResponse(null, { status: 400 });

  await notifyPresence(ctx.organizationId, dados.data.conversationId, dados.data.presence).catch(
    () => undefined,
  );
  // Sem corpo de propósito: quem avisa presença não espera resposta.
  return new NextResponse(null, { status: 204 });
}
