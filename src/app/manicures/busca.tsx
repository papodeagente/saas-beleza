"use client";

import { Loader2, MapPin, Navigation, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Municipio } from "@/server/services/location-service";
import { buscarCidadesAction, cidadesPertoAction } from "./actions";

/**
 * Os controles da busca: onde e o quê.
 *
 * O CAMPO É 16px, não por estética. Abaixo disso o Safari do iPhone dá zoom
 * sozinho ao focar, e a página inteira reescala no primeiro toque de quem
 * chegou pelo celular — que é quase todo mundo neste tipo de busca.
 */
const CAMPO =
  "h-12 w-full rounded-control border border-[var(--color-cartao-fio)] bg-cartao px-3.5 text-card font-normal text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Busca({
  cidadeAtual,
  termoAtual,
}: {
  cidadeAtual: { ibgeCode: number; name: string; uf: string } | null;
  termoAtual: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [termo, setTermo] = useState(termoAtual);
  const [sugestoes, setSugestoes] = useState<Municipio[]>([]);
  const [aberto, setAberto] = useState(false);
  const [buscando, iniciarBusca] = useTransition();
  const [localizando, setLocalizando] = useState(false);
  const [erroGps, setErroGps] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  /**
   * A busca de cidade espera 220ms depois da última tecla.
   *
   * Sem isso, "florianópolis" dispara catorze consultas ao banco — uma por
   * letra — e a última a voltar nem sempre é a da última tecla, então a lista
   * pisca com resultado errado.
   */
  useEffect(() => {
    // A limpeza da lista mora no `onChange`, não aqui: `setState` síncrono
    // dentro de um efeito agenda uma segunda renderização em cima da primeira,
    // e num campo que muda a cada tecla isso vira cascata.
    if (texto.trim().length < 2) return;
    const id = setTimeout(() => {
      iniciarBusca(async () => setSugestoes(await buscarCidadesAction(texto)));
    }, 220);
    return () => clearTimeout(id);
  }, [texto]);

  // Clique fora fecha a lista. Sem isso ela fica pendurada sobre os resultados.
  useEffect(() => {
    function fora(evento: MouseEvent) {
      if (caixa.current && !caixa.current.contains(evento.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  function irPara(params: Record<string, string | undefined>) {
    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) if (valor) busca.set(chave, valor);
    router.push(busca.size ? `/manicures?${busca}` : "/manicures");
  }

  function escolherCidade(m: Municipio) {
    setAberto(false);
    setTexto("");
    irPara({ cidade: String(m.ibgeCode), q: termo || undefined });
  }

  /**
   * O GPS do navegador.
   *
   * `navigator.geolocation` exige HTTPS e permissão explícita, e a recusa é o
   * caminho NORMAL — muita gente nega por reflexo. Por isso o erro não é um
   * beco: ele volta dizendo para digitar a cidade, que é o caminho que sempre
   * funciona.
   */
  function usarLocalizacao() {
    setErroGps(null);
    if (!("geolocation" in navigator)) {
      setErroGps("Seu navegador não informa a localização. Digite sua cidade.");
      return;
    }
    setLocalizando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const cidades = await cidadesPertoAction({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocalizando(false);
        if (!cidades.length) {
          setErroGps("Não achamos cidades perto de você. Digite sua cidade.");
          return;
        }
        // A coordenada real vai junto: ela ordena as CIDADES por proximidade.
        irPara({
          cidade: String(cidades[0].ibgeCode),
          lat: String(pos.coords.latitude.toFixed(5)),
          lng: String(pos.coords.longitude.toFixed(5)),
          q: termo || undefined,
        });
      },
      () => {
        setLocalizando(false);
        setErroGps("Não conseguimos sua localização. Digite sua cidade.");
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Cidade */}
        <div ref={caixa} className="relative flex-1">
          {cidadeAtual ? (
            <div className="flex h-12 items-center gap-2 rounded-control border border-[var(--color-cartao-fio)] bg-cartao px-3.5">
              <MapPin aria-hidden className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-card font-normal text-ink">
                {cidadeAtual.name}/{cidadeAtual.uf}
              </span>
              <button
                type="button"
                onClick={() => irPara({ q: termo || undefined })}
                aria-label="Limpar cidade"
                className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <label htmlFor="cidade" className="sr-only">
                Sua cidade
              </label>
              <input
                id="cidade"
                className={CAMPO}
                value={texto}
                onChange={(e) => {
                  const valor = e.target.value;
                  setTexto(valor);
                  setAberto(true);
                  if (valor.trim().length < 2) setSugestoes([]);
                }}
                onFocus={() => setAberto(true)}
                placeholder="Sua cidade"
                autoComplete="address-level2"
                role="combobox"
                aria-expanded={aberto && sugestoes.length > 0}
                aria-controls="lista-cidades"
              />
              {buscando ? (
                <Loader2
                  aria-hidden
                  className="absolute right-3.5 top-4 size-4 animate-spin text-ink-tertiary"
                />
              ) : null}
              {aberto && sugestoes.length > 0 ? (
                <ul
                  id="lista-cidades"
                  role="listbox"
                  className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto rounded-card border border-[var(--color-cartao-linha)] bg-cartao py-1 shadow-[var(--shadow-overlay)]"
                >
                  {sugestoes.map((m) => (
                    <li key={m.ibgeCode}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => escolherCidade(m)}
                        className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-body text-ink transition-colors hover:bg-[var(--color-cartao-sunken)]"
                      >
                        <MapPin aria-hidden className="size-3.5 shrink-0 text-ink-tertiary" />
                        <span className="min-w-0 truncate">
                          {m.name}
                          <span className="text-ink-secondary">/{m.uf}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {/* Serviço ou nome do salão */}
        <div className="relative flex-1">
          <label htmlFor="q" className="sr-only">
            Serviço ou nome do salão
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-4 size-4 text-ink-tertiary"
          />
          <input
            id="q"
            className={cn(CAMPO, "pl-10")}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                irPara({
                  cidade: cidadeAtual ? String(cidadeAtual.ibgeCode) : undefined,
                  q: termo || undefined,
                });
              }
            }}
            placeholder="Alongamento, esmaltação…"
            enterKeyHint="search"
          />
        </div>

        <Button
          variant="secondary"
          className="h-12 shrink-0"
          loading={localizando}
          onClick={usarLocalizacao}
        >
          <Navigation aria-hidden />
          Perto de mim
        </Button>
      </div>

      {erroGps ? (
        <p role="alert" className="text-caption text-ink-secondary">
          {erroGps}
        </p>
      ) : null}
    </div>
  );
}
