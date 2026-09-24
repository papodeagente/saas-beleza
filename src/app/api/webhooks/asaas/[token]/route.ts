import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { asaasAccounts } from "@/db/schema";
import {
  confirmarPagamento,
  decisaoDoEvento,
  registrarEstorno,
} from "@/server/services/booking-payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Avisos de pagamento do Asaas, um caminho por clínica.
 *
 * O segredo é a própria URL, como no webhook do WhatsApp: cada conta recebe um
 * caminho único, registrado automaticamente na conta dela do Asaas. Quando o
 * Asaas também manda o `asaas-access-token`, ele é conferido; quando não manda
 * (conta configurada à mão pelo painel), o segredo do caminho é o que vale.
 *
 * **Responde 200 para quase tudo, de propósito.** O Asaas INTERROMPE a fila de
 * webhooks da conta depois de falhas repetidas: uma sequência de 500 nossos
 * pararia de entregar os avisos de pagamento daquela clínica até alguém
 * reativar a fila no painel dela. Evento que não nos interessa, cobrança que
 * não é nossa e link desconhecido saem com 200. O 500 fica para o caso em que
 * a reentrega ajuda de verdade: falha ao gravar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [conta] = await db
    .select()
    .from(asaasAccounts)
    .where(eq(asaasAccounts.webhookToken, token))
    .limit(1);
  if (!conta) return new NextResponse(null, { status: 404 });

  const enviado = request.headers.get("asaas-access-token");
  if (enviado && enviado !== conta.webhookToken) {
    return new NextResponse(null, { status: 401 });
  }

  const corpo = (await request.json().catch(() => null)) as {
    event?: string;
    payment?: {
      id?: string;
      value?: number;
      billingType?: string;
      paymentLink?: string | null;
      status?: string;
    };
  } | null;

  const evento = corpo?.event ?? "";
  const pagamento = corpo?.payment;

  // A conta do Asaas da clínica é dela: recebe cobrança de coisa que não passa
  // por aqui. Sem link, ou com link que não é nosso, não há o que fazer.
  if (!pagamento?.paymentLink || !pagamento.id) {
    return NextResponse.json({ ok: true, ignorado: "sem_link" });
  }

  try {
    const decisao = decisaoDoEvento(evento);

    if (decisao === "confirmar") {
      const resultado = await confirmarPagamento(conta.organizationId, {
        linkId: pagamento.paymentLink,
        pagamentoId: pagamento.id,
        valorCents: Math.round((pagamento.value ?? 0) * 100),
        billingType: pagamento.billingType ?? null,
      });
      return NextResponse.json({ ok: true, agendamento: resultado?.appointmentId ?? null });
    }

    if (decisao === "estornar") {
      await registrarEstorno(conta.organizationId, pagamento.paymentLink);
      return NextResponse.json({ ok: true, estornado: true });
    }

    // Vencimento e os demais eventos não mexem na reserva: quem derruba
    // reserva vencida é a nossa varredura, com o nosso prazo, que é bem mais
    // curto que o vencimento do boleto do Asaas.
    return NextResponse.json({ ok: true, ignorado: evento || "sem_evento" });
  } catch (erro) {
    console.error("[asaas webhook] falha ao processar:", erro instanceof Error ? erro.message : erro);
    // Aqui o 500 é desejado: a reentrega do Asaas é a segunda chance de
    // confirmar um pagamento que já aconteceu.
    return new NextResponse(null, { status: 500 });
  }
}
