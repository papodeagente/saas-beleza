import { notFound } from "next/navigation";
import { checkoutPorToken } from "@/server/services/booking-payment-service";
import { CheckoutView } from "./checkout-view";

export const dynamic = "force-dynamic";
/** Página de pagamento não é para indexar nem para pré-visualizar em link. */
export const metadata = { title: "Pagamento", robots: { index: false, follow: false } };

/**
 * O checkout de uma reserva.
 *
 * Endereço público, autorizado pelo token: é o que a cliente recebe no
 * WhatsApp e o que a página de agendamento abre depois de guardar o horário.
 * Token desconhecido é 404 — sem mensagem que ajude a adivinhar outro.
 */
export default async function PaginaDePagamento({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reserva = await checkoutPorToken(token);
  if (!reserva) notFound();

  return <CheckoutView token={token} reserva={reserva} />;
}
