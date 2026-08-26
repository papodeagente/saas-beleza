import { erro, json, numeroDe, podeConsultar } from "../../../_resposta";
import {
  getPublicAvailableDays,
  getPublicSlots,
} from "@/server/services/public-booking-service";

export const dynamic = "force-dynamic";

/**
 * Os horários de um salão.
 *
 * `?servico=` obrigatório. Com `?data=` devolve os horários daquele dia; sem
 * ela devolve os DIAS que têm vaga nas próximas semanas — que é o que a tela
 * pede primeiro.
 *
 * Consome exatamente as mesmas funções que a página de agendamento: a
 * disponibilidade tem uma fonte só (`getAvailableSlots`), e um app que
 * calculasse horário por conta própria acabaria oferecendo vaga que não existe.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await podeConsultar())) return erro("Muitas consultas. Tente em instantes.", 429);

  const { slug } = await params;
  const url = new URL(request.url);
  const serviceId = numeroDe(url, "servico");
  if (!serviceId) return erro("Informe o serviço.", 400);
  const branchId = numeroDe(url, "unidade");

  const data = url.searchParams.get("data");
  if (data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erro("Data inválida.", 400);
    return json({ horarios: await getPublicSlots(slug, { serviceId, dateISO: data, branchId }) });
  }

  // Mesma janela que a página usa: três semanas.
  const hoje = new Date();
  const dias = Array.from({ length: 21 }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return json({ dias: await getPublicAvailableDays(slug, { serviceId, dateISOs: dias, branchId }) });
}
