import { notFound } from "next/navigation";
import {
  getPublicOrganization,
  publicOrganizationExists,
} from "@/server/services/public-booking-service";
import { BookingFlow } from "./booking-flow";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const org = await getPublicOrganization((await params).slug);
  return {
    title: org ? `Agendar — ${org.organization.name}` : "Agendamento",
    description: org ? `Escolha seu horário na ${org.organization.name}.` : undefined,
  };
}

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getPublicOrganization(slug);
  if (!org) {
    /**
     * Conta que existe mas não pode vender hoje (suspensa, teste vencido,
     * cancelada com o período já encerrado) não é 404. Quem chegou aqui veio de
     * um cartão, de um panfleto ou da bio do Instagram: "página não encontrada"
     * faria a pessoa achar que digitou errado e tentar de novo. O texto é
     * neutro de propósito — a situação comercial do salão não é assunto da
     * cliente.
     */
    if (await publicOrganizationExists(slug)) return <AgendaIndisponivel />;
    notFound();
  }

  return (
    <BookingFlow
      slug={slug}
      organizationName={org.organization.name}
      branches={org.branches}
      services={org.services}
    />
  );
}

/**
 * A agenda existe, mas não está recebendo marcação agora.
 *
 * Sem logo da Agenda de Unha e sem menção a pagamento: quem vê esta tela é a
 * cliente do salão, e nem o problema nem o fornecedor são assunto dela.
 */
function AgendaIndisponivel() {
  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <div aria-hidden className="h-1 shrink-0 bg-brand" />
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-5 py-16">
        <div className="rounded-overlay border border-line bg-surface-raised p-8 shadow-card">
          <h1 className="font-brand text-house text-ink">Agenda indisponível</h1>
          <p className="mt-3 text-body text-ink-secondary">
            Esta agenda não está recebendo marcações online no momento. Fale direto com o salão
            para combinar seu horário.
          </p>
        </div>
      </div>
    </main>
  );
}
