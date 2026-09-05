import { erro, json, podeConsultar } from "../../_resposta";
import { perfilPublico } from "@/server/services/marketplace-service";
import { getPublicOrganization } from "@/server/services/public-booking-service";

export const dynamic = "force-dynamic";

/**
 * O perfil de um salão, com a carta de serviços.
 *
 * As duas leituras precisam concordar, pelo mesmo motivo da página: `perfilPublico`
 * responde "está no diretório" e `getPublicOrganization` responde "pode receber
 * marcação" — este último é quem carrega o portão comercial.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await podeConsultar())) return erro("Muitas consultas. Tente em instantes.", 429);

  const { slug } = await params;
  const [perfil, agenda] = await Promise.all([perfilPublico(slug), getPublicOrganization(slug)]);
  if (!perfil || !agenda) return erro("Salão não encontrado.", 404);

  return json({
    salao: perfil,
    servicos: agenda.services,
    fuso: agenda.organization.timezone,
  });
}
