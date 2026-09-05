import { erro, json, numeroDe, podeConsultar } from "../_resposta";
import { buscarMunicipios, municipiosProximos } from "@/server/services/location-service";

export const dynamic = "force-dynamic";

/**
 * Cidades — por nome (`?q=`) ou por coordenada (`?lat=&lng=`).
 *
 * Uma rota e não duas porque é uma pergunta só: "que cidade é essa?". O app
 * chama com GPS na abertura e com texto enquanto a pessoa digita.
 */
export async function GET(request: Request) {
  if (!(await podeConsultar())) return erro("Muitas consultas. Tente em instantes.", 429);

  const url = new URL(request.url);
  const lat = numeroDe(url, "lat");
  const lng = numeroDe(url, "lng");

  if (lat != null && lng != null) {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return erro("Coordenada inválida.", 400);
    const raio = Math.min(200, numeroDe(url, "raio") ?? 80);
    return json({ cidades: await municipiosProximos(lat, lng, raio, 8) });
  }

  const termo = url.searchParams.get("q") ?? "";
  return json({ cidades: await buscarMunicipios(termo.slice(0, 120)) });
}
