import { MapPin } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { municipioPorCodigo } from "@/server/services/location-service";
import { buscarSaloes, cidadesComSalao } from "@/server/services/marketplace-service";
import { Busca } from "./busca";
import { CartaoSalao } from "./cartao";

/**
 * O diretório de manicures.
 *
 * `force-dynamic` porque o resultado depende de onde a pessoa está e do que ela
 * digitou, e porque a clínica que acaba de ligar o interruptor precisa se
 * encontrar na hora — servir uma versão cacheada faria ela concluir que não
 * funcionou.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manicures perto de você",
  description:
    "Encontre manicures e nail designers por cidade, veja preços e agende seu horário online.",
};

type Params = Promise<{ cidade?: string; lat?: string; lng?: string; q?: string; pagina?: string }>;

/** Number() aceita "" e devolve 0; aqui vazio precisa virar undefined. */
function numero(valor: string | undefined): number | undefined {
  if (!valor) return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

export default async function DiretorioPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const ibgeCode = numero(params.cidade);
  const lat = numero(params.lat);
  const lng = numero(params.lng);
  const termo = params.q?.slice(0, 120) ?? "";
  const pagina = Math.max(1, numero(params.pagina) ?? 1);

  const cidade = ibgeCode ? await municipioPorCodigo(ibgeCode) : null;

  /**
   * A coordenada que ordena.
   *
   * Se o GPS veio, é ele. Se a pessoa só escolheu a cidade, é o centro dela —
   * assim a lista sai ordenada por proximidade mesmo sem GPS, e cidades
   * vizinhas aparecem depois das da própria cidade em vez de em ordem
   * alfabética arbitrária.
   */
  const origemLat = lat ?? cidade?.lat;
  const origemLng = lng ?? cidade?.lng;

  const [{ itens, total }, cidadesDestaque] = await Promise.all([
    buscarSaloes({
      ibgeCode,
      lat: origemLat,
      lng: origemLng,
      termo,
      pagina,
      porPagina: 12,
    }),
    // Só custa quando não há filtro nenhum — é a tela de entrada.
    ibgeCode || termo ? Promise.resolve([]) : cidadesComSalao(12),
  ]);

  const temFiltro = Boolean(ibgeCode || termo || lat);

  return (
    <main data-surface="cartao" className="grao relative isolate min-h-dvh bg-balcao">
      <div className="mx-auto w-full max-w-[1080px] px-5 pb-20 sm:px-8">
        <header className="pt-8 sm:pt-12">
          <BrandLogo compact className="[&_img]:h-8" />
          <h1 className="mt-5 font-brand text-fachada text-ink">
            Encontre sua manicure
          </h1>
          <p className="mt-2 max-w-prose text-body text-ink-secondary">
            Busque por cidade ou use sua localização. Você escolhe o horário e agenda direto, sem
            criar conta.
          </p>
        </header>

        <div className="mt-6">
          <Busca
            cidadeAtual={
              cidade ? { ibgeCode: cidade.ibgeCode, name: cidade.name, uf: cidade.uf } : null
            }
            termoAtual={termo}
          />
        </div>

        {/* Cidades que já têm salão — a porta de entrada de quem chega sem filtro */}
        {!temFiltro && cidadesDestaque.length > 0 ? (
          <section className="mt-8" aria-labelledby="cidades">
            <h2 id="cidades" className="text-section">
              <span>Onde já tem manicure</span>
            </h2>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {cidadesDestaque.map((c) => (
                <li key={c.ibgeCode}>
                  <Link
                    href={`/manicures?cidade=${c.ibgeCode}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-[var(--color-cartao-linha)] bg-cartao px-3.5 text-label text-ink transition-colors hover:border-accent/40"
                  >
                    <MapPin aria-hidden className="size-3.5 text-ink-tertiary" />
                    {c.cidade}
                    <span className="text-ink-secondary">/{c.uf}</span>
                    <span className="tabular text-caption text-ink-tertiary">{c.saloes}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Resultados */}
        <section className="mt-8" aria-labelledby="resultados">
          <h2 id="resultados" className="text-section">
            <span>
              {total === 0
                ? "Nenhum salão encontrado"
                : `${total} ${total === 1 ? "salão" : "salões"}${cidade ? ` em ${cidade.name}` : ""}`}
            </span>
          </h2>

          {itens.length > 0 ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {itens.map((salao) => (
                <CartaoSalao key={`${salao.organizationId}-${salao.branchId}`} salao={salao} />
              ))}
            </ul>
          ) : (
            <VazioDoDiretorio temFiltro={temFiltro} cidade={cidade?.name ?? null} />
          )}

          <Paginacao total={total} pagina={pagina} porPagina={12} params={params} />
        </section>

        <footer className="mt-16 border-t border-[var(--color-cartao-linha)] pt-6">
          <p className="text-caption text-ink-secondary">
            É manicure e quer aparecer aqui?{" "}
            <Link
              href="/criar-conta"
              className="text-accent underline-offset-4 hover:underline"
            >
              Cadastre seu salão
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}

/**
 * O vazio.
 *
 * Diretório novo começa vazio por construção — a listagem é opt-in e ninguém
 * optou ainda. A tela precisa dizer isso sem parecer defeito, e sem prometer
 * salões que não existem.
 */
function VazioDoDiretorio({ temFiltro, cidade }: { temFiltro: boolean; cidade: string | null }) {
  return (
    <div className="mt-3 rounded-card border border-[var(--color-cartao-linha)] bg-cartao px-5 py-10 text-center">
      <p className="text-card text-ink">
        {temFiltro
          ? cidade
            ? `Ainda não temos manicure cadastrada em ${cidade}`
            : "Nada encontrado com esse termo"
          : "O diretório está começando agora"}
      </p>
      <p className="mx-auto mt-2 max-w-prose text-body text-ink-secondary">
        {temFiltro
          ? "Tente outra cidade ou limpe a busca para ver todas as manicures cadastradas."
          : "As manicures estão entrando aos poucos. Volte em breve — ou, se você é profissional, seja uma das primeiras."}
      </p>
      {temFiltro ? (
        <Link
          href="/manicures"
          className="mt-5 inline-flex min-h-11 items-center text-label text-accent underline-offset-4 hover:underline"
        >
          Ver todas
        </Link>
      ) : null}
    </div>
  );
}

function Paginacao({
  total,
  pagina,
  porPagina,
  params,
}: {
  total: number;
  pagina: number;
  porPagina: number;
  params: Awaited<Params>;
}) {
  const paginas = Math.ceil(total / porPagina);
  if (paginas <= 1) return null;
  const link = (n: number) => {
    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) if (valor) busca.set(chave, String(valor));
    busca.set("pagina", String(n));
    return `/manicures?${busca}`;
  };
  return (
    <nav aria-label="Páginas de resultado" className="mt-8 flex items-center justify-between gap-3">
      {pagina > 1 ? (
        <Link
          href={link(pagina - 1)}
          className="inline-flex min-h-11 items-center rounded-control border border-[var(--color-cartao-fio)] px-4 text-label text-ink"
        >
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-caption text-ink-secondary">
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? (
        <Link
          href={link(pagina + 1)}
          className="inline-flex min-h-11 items-center rounded-control border border-[var(--color-cartao-fio)] px-4 text-label text-ink"
        >
          Próxima
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
