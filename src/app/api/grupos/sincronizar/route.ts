import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, requireRole } from "@/server/auth";
import { getAccountAccess } from "@/server/services/account-access";
import { reconcileGroupHistory, syncGroupsFromProvider } from "@/server/services/group-inbox-service";

/**
 * Ida ao WhatsApp da tela de grupos — fora do canal de server action.
 *
 * POR QUE NÃO É UMA SERVER ACTION: o navegador despacha server actions UMA DE
 * CADA VEZ (está escrito na própria documentação do Next, em
 * `01-getting-started/07-mutating-data.md`, com a recomendação de usar Route
 * Handler quando o trabalho é paralelo). Estas duas buscas custam segundos —
 * 23 s medidos na conta do dono para a lista, 11 s para o histórico de um
 * grupo — e enquanto uma delas ocupava a fila, TODO clique seguinte ficava
 * parado atrás: trocar de gaveta ou buscar deixava a lista em esqueleto pelos
 * 23 s inteiros, sem o pedido sequer sair do navegador. Elas eram trabalho de
 * fundo no servidor e trabalho de primeiro plano na fila do cliente.
 *
 * Numa rota comum o pedido sai na hora e não atravanca nada: a lista continua
 * respondendo enquanto a busca acontece, que era a promessa desta tela.
 */

const corpo = z.object({
  /** Com JID, reconcilia o fio daquele grupo; sem, atualiza a lista inteira. */
  jid: z.string().trim().endsWith("@g.us").optional(),
});

function mensagem(error: unknown): string {
  if (!(error instanceof Error)) return "Não foi possível concluir.";
  if (error.message === "SEM_CONEXAO") return "Conecte o WhatsApp antes de atualizar os grupos.";
  if (error.message.includes("401")) return "A instância recusou o token. Verifique a conexão.";
  return error.message;
}

export async function POST(request: Request) {
  const ctx = await getSession();
  if (!ctx) return NextResponse.json({ ok: false, error: "Sessão expirada." }, { status: 401 });
  try {
    requireRole(ctx, "staff");
  } catch {
    return NextResponse.json({ ok: false, error: "Você não tem permissão para isso." }, { status: 403 });
  }

  // A mesma porteira de `requireSession`, escrita à mão: numa rota o `redirect`
  // dele viraria um 307 para uma página HTML, e o `fetch` daqui receberia isso
  // no lugar da resposta — assinatura vencida não pode virar erro de rede.
  const acesso = await getAccountAccess(ctx.organizationId);
  if (!acesso.allowed) {
    return NextResponse.json({ ok: false, error: "Assinatura inativa." }, { status: 402 });
  }

  const bruto = await request.json().catch(() => ({}));
  const dados = corpo.safeParse(bruto ?? {});
  if (!dados.success) return NextResponse.json({ ok: false, error: "Grupo inválido." }, { status: 400 });

  try {
    if (dados.data.jid) {
      const importadas = await reconcileGroupHistory(ctx, dados.data.jid);
      return NextResponse.json({ ok: true, data: { importadas } });
    }
    const resultado = await syncGroupsFromProvider(ctx);
    // A próxima navegação para /grupos monta a primeira página no servidor: sem
    // isto ela sairia do cache antigo, sem nada do que acabou de chegar.
    revalidatePath("/grupos");
    return NextResponse.json({ ok: true, data: resultado });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: mensagem(error) }, { status: 200 });
  }
}
