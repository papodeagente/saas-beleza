import { notFound } from "next/navigation";
import { getPublicOrganization } from "@/server/services/public-booking-service";
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
  if (!org) notFound();

  return (
    <BookingFlow
      slug={slug}
      organizationName={org.organization.name}
      branches={org.branches}
      services={org.services}
    />
  );
}
