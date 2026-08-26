import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { formatBRL } from "@/lib/money";
import type { CartaoDoSalao } from "@/server/services/marketplace-service";

/**
 * Como a distância é dita — e por que ela quase nunca vira metros.
 *
 * A precisão do cadastro hoje é de CIDADE: o CEP normaliza o endereço mas não
 * devolve coordenada, então toda unidade cadastrada por CEP fica no centro do
 * município. Escrever "a 800m de você" com esse dado é mentira, e é a mentira
 * clássica de marketplace geolocalizado — a cliente sai de casa contando com
 * uma quadra e anda três quilômetros.
 *
 * Então: com precisão de cidade a tela fala em CIDADE ("na sua cidade", "a
 * 14 km" arredondado para o inteiro). Metros só aparecem quando a precisão for
 * de rua ou de porta, que é o que um geocodificador ou o pino no mapa trarão
 * depois. Este é o único lugar que muda quando isso acontecer.
 */
function comoDizerDistancia(km: number | null, precisao: CartaoDoSalao["precisao"]): string | null {
  if (km == null) return null;
  if (precisao === "cidade" || precisao === "nenhuma") {
    if (km < 5) return "na sua cidade";
    return `${Math.round(km)} km de você`;
  }
  if (km < 1) return `${Math.round(km * 1000)} m de você`;
  return `${km.toFixed(1).replace(".", ",")} km de você`;
}

export function CartaoSalao({ salao }: { salao: CartaoDoSalao }) {
  const distancia = comoDizerDistancia(salao.km, salao.precisao);
  return (
    <li>
      <Link
        href={`/manicures/${salao.slug}`}
        className="group flex h-full flex-col rounded-card border border-[var(--color-cartao-linha)] bg-cartao p-4 shadow-card transition-[border-color,box-shadow,transform] active:scale-[0.995] sm:hover:-translate-y-0.5 sm:hover:border-accent/40 sm:hover:shadow-[var(--shadow-card-hover)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-card text-ink">{salao.nome}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-ink-secondary">
              <MapPin aria-hidden className="size-3.5 shrink-0 text-ink-tertiary" />
              <span className="min-w-0 truncate">
                {[salao.bairro, `${salao.cidade}/${salao.uf}`].filter(Boolean).join(" · ")}
              </span>
              {distancia ? (
                <>
                  <span aria-hidden className="text-ink-tertiary">
                    ·
                  </span>
                  <span>{distancia}</span>
                </>
              ) : null}
            </p>
          </div>
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-ink-tertiary transition-colors group-hover:text-accent"
          />
        </div>

        {salao.bio ? (
          <p className="mt-2.5 line-clamp-2 text-caption text-ink-secondary">{salao.bio}</p>
        ) : null}

        {salao.categorias.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {salao.categorias.map((categoria) => (
              <li
                key={categoria}
                className="rounded-pill bg-[var(--color-cartao-sunken)] px-2.5 py-1 text-meta text-ink-secondary"
              >
                {categoria}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto flex items-baseline justify-between gap-3 pt-4">
          <span className="text-caption text-ink-secondary">
            {salao.servicos} {salao.servicos === 1 ? "serviço" : "serviços"}
          </span>
          {salao.precoMinCents != null ? (
            <span className="text-right">
              <span className="block text-meta text-ink-secondary">a partir de</span>
              <span className="text-price tabular text-ink">{formatBRL(salao.precoMinCents)}</span>
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
