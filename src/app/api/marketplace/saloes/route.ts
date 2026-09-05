import { erro, json, numeroDe, podeConsultar } from "../_resposta";
import { buscarSaloes, cidadesComSalao } from "@/server/services/marketplace-service";

export const dynamic = "force-dynamic";

/**
 * A busca do diretório.
 *
 * `?cidade=` é o código do IBGE; `?lat=&lng=` é o GPS de quem procura; `?q=`
 * casa nome do salão ou nome de serviço. Sem nenhum filtro devolve também as
 * cidades que já têm salão, que é o que a tela de entrada mostra — assim o app
 * abre com UMA chamada, não duas.
 */
export async function GET(request: Request) {
  if (!(await podeConsultar())) return erro("Muitas consultas. Tente em instantes.", 429);

  const url = new URL(request.url);
  const ibgeCode = numeroDe(url, "cidade");
  const lat = numeroDe(url, "lat");
  const lng = numeroDe(url, "lng");
  const termo = (url.searchParams.get("q") ?? "").slice(0, 120);
  const pagina = numeroDe(url, "pagina") ?? 1;

  if (lat != null && (Math.abs(lat) > 90 || Math.abs(lng ?? 0) > 180)) {
    return erro("Coordenada inválida.", 400);
  }

  const semFiltro = !ibgeCode && !termo && lat == null;
  const [resultado, cidades] = await Promise.all([
    buscarSaloes({ ibgeCode, lat, lng, termo, pagina, porPagina: numeroDe(url, "porPagina") }),
    semFiltro ? cidadesComSalao(12) : Promise.resolve([]),
  ]);

  return json({ ...resultado, pagina, ...(semFiltro ? { cidades } : {}) });
}
