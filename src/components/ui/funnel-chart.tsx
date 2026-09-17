"use client";

import { ArrowDown, TrendingDown } from "lucide-react";
import { motion, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { FunnelStageMetric } from "@/server/services/booking-funnel-service";

/**
 * Os seis degraus moram em globals.css (`--funnel-step-*`). Cor que não está no
 * tema é cor que ninguém acha quando a marca muda, e este é o único gráfico do
 * produto com paleta própria.
 */
const DEGRAUS = [
  "var(--funnel-step-1)",
  "var(--funnel-step-2)",
  "var(--funnel-step-3)",
  "var(--funnel-step-4)",
  "var(--funnel-step-5)",
  "var(--funnel-step-6)",
];

/**
 * CAMADAS da silhueta: cascas concêntricas translúcidas, da mais aberta à mais
 * fechada. É o que dá volume ao funil sem sombra nem gradiente — a de dentro é
 * opaca, as de fora insinuam a parede do funil.
 */
const CAMADAS = 3;

/**
 * Largura mínima de uma faixa, em fração da área do gráfico.
 *
 * Existe porque este funil despenca de verdade: numa conta real são 195 acessos
 * para 5 agendamentos, e a segunda faixa mede 2,6% da primeira. Sem piso ela
 * desenha meio pixel — some da tela, e com ela somem as quatro etapas seguintes.
 *
 * O piso é pequeno de propósito (6%, não os 16% da versão anterior): o tombo
 * PRECISA aparecer, porque ele é o assunto da tela. O que o piso compra é só
 * que a etapa continue existindo como forma; quem carrega o número exato é a
 * lista ao lado, que nunca é arredondada.
 */
const PISO = 0.07;

/**
 * A largura da faixa é a RAIZ QUADRADA da participação, não a participação.
 *
 * Isto é uma distorção deliberada e vale explicar, porque distorcer escala é
 * normalmente o pecado dos gráficos. Numa conta real deste produto a jornada vai
 * de 195 acessos para 5 agendamentos: 2,6%. Desenhada em proporção direta, a
 * primeira faixa é a largura inteira e TODAS as outras cinco viram o mesmo fio
 * de meio pixel — medido, o funil sai com forma de T e não distingue a etapa
 * que ainda tem gente da que zerou. Foi testado antes de escrever isto.
 *
 * A raiz preserva o que importa e só comprime o que não cabe: maior continua
 * maior, igual continua igual, e a queda continua sendo de longe o maior salto
 * do desenho. O que ela não preserva é a razão entre as larguras — por isso
 * NENHUM número desta tela sai da raiz. O valor exato está escrito na própria
 * faixa e a conversão está na lista ao lado, as duas em proporção direta.
 *
 * Se um dia a conta tiver queda suave, a raiz quase não muda nada: com 100 para
 * 80 a largura vai a 89%, contra os 80% da proporção direta.
 */
const escalaDaLargura = (valor: number, maior: number) => Math.sqrt(Math.max(valor, 0) / maior);

/**
 * A boca do funil não encosta nas laterais: 92% em vez de 100%.
 *
 * As cascas de fora abrem além da faixa ao passar o mouse, e com a primeira
 * ocupando a largura inteira elas saíam pela borda do cartão e apareciam
 * cortadas. A folga é o espaço que a animação precisa para existir.
 */
const BOCA = 0.82;

/**
 * Caminho de uma faixa do funil: largura `de` no topo, `para` embaixo.
 *
 * As laterais são curvas (Bézier com controle a 55% da altura) e não retas.
 * Faixas retas empilhadas leem como seis trapézios soltos; a curva faz as seis
 * virarem uma parede só, que é o que o olho reconhece como funil.
 */
function caminhoDaFaixa(de: number, para: number, altura: number, largura: number, escala: number) {
  const meio = largura / 2;
  const a = de * largura * 0.5 * escala;
  const b = para * largura * 0.5 * escala;
  // Controle a 30% da altura, e não a 55%. Com 55% a parede fica reta perto das
  // duas pontas e a queda vira um degrau seco no meio — com 195 para 5 o
  // desenho saía com cara de bigorna. A 30% a parede despenca desde o topo,
  // que é o que de fato acontece com a jornada.
  const c = altura * 0.42;
  return [
    `M ${meio - a} 0`,
    `C ${meio - a} ${c}, ${meio - b} ${altura - c}, ${meio - b} ${altura}`,
    `L ${meio + b} ${altura}`,
    `C ${meio + b} ${altura - c}, ${meio + a} ${c}, ${meio + a} 0`,
    "Z",
  ].join(" ");
}

/**
 * Uma casca. Ao passar o mouse ela ABRE um pouco, e as de fora abrem mais que
 * as de dentro — o funil respira em vez de piscar. Cada casca tem sua própria
 * mola, mais lenta conforme se afasta do centro.
 */
function Casca({
  d,
  cor,
  opacidade,
  ativa,
  indice,
  parado,
}: {
  d: string;
  cor: string;
  opacidade: number;
  ativa: boolean;
  indice: number;
  parado: boolean;
}) {
  const abertura = 1 + (indice / Math.max(CAMADAS - 1, 1)) * 0.1;
  const escalaX = useSpring(1, { stiffness: 300 - indice * 60, damping: 24 - indice * 3 });

  useEffect(() => {
    escalaX.set(ativa && !parado ? abertura : 1);
  }, [ativa, parado, escalaX, abertura]);

  return (
    <motion.path
      d={d}
      fill={cor}
      opacity={opacidade}
      style={{ scaleX: escalaX, transformOrigin: "center center" }}
    />
  );
}

function Faixa({
  indice,
  de,
  para,
  altura,
  largura,
  cor,
  ativa,
  apagada,
  parado,
}: {
  indice: number;
  de: number;
  para: number;
  altura: number;
  largura: number;
  cor: string;
  ativa: boolean;
  apagada: boolean;
  parado: boolean;
}) {
  const entrada = useSpring(parado ? 1 : 0, { stiffness: 120, damping: 20, mass: 1 });
  const opacidade = useSpring(1, { stiffness: 300, damping: 24 });

  useEffect(() => {
    opacidade.set(apagada ? 0.35 : 1);
  }, [apagada, opacidade]);

  useEffect(() => {
    if (parado) {
      entrada.jump(1);
      return;
    }
    // A entrada é escalonada: o funil se preenche de cima para baixo, na ordem
    // em que a jornada acontece.
    const relogio = setTimeout(() => entrada.set(1), indice * 90);
    return () => clearTimeout(relogio);
  }, [entrada, indice, parado]);

  const cascas = Array.from({ length: CAMADAS }, (_, camada) => ({
    d: caminhoDaFaixa(de, para, altura, largura, 1 - (camada / CAMADAS) * 0.35),
    opacidade: 0.18 + (camada / Math.max(CAMADAS - 1, 1)) * 0.65,
  }));

  return (
    <motion.g style={{ opacity: opacidade }}>
      <motion.g
        style={{
          scaleY: entrada,
          scaleX: entrada,
          transformOrigin: `${largura / 2}px 0px`,
          translateY: indice * altura,
        }}
      >
        {cascas.map((casca) => (
          <Casca
            ativa={ativa}
            cor={cor}
            d={casca.d}
            indice={cascas.indexOf(casca)}
            key={casca.opacidade.toFixed(2)}
            opacidade={casca.opacidade}
            parado={parado}
          />
        ))}
      </motion.g>
    </motion.g>
  );
}

export function FunnelChart({ stages }: { stages: FunnelStageMetric[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const moldura = useRef<HTMLDivElement>(null);
  const [caixa, setCaixa] = useState({ largura: 0, altura: 0 });
  const parado = useReducedMotion() ?? false;

  const medir = useCallback(() => {
    const alvo = moldura.current;
    if (!alvo) return;
    const { width, height } = alvo.getBoundingClientRect();
    if (width > 0 && height > 0) setCaixa({ largura: width, altura: height });
  }, []);

  useEffect(() => {
    medir();
    const observador = new ResizeObserver(medir);
    if (moldura.current) observador.observe(moldura.current);
    return () => observador.disconnect();
  }, [medir]);

  const maior = Math.max(...stages.map((etapa) => etapa.value), 1);
  /**
   * Largura de cada etapa, já com o piso. A última repete a si mesma porque a
   * silhueta precisa de um "para onde ir" na faixa de baixo — o funil termina
   * reto, não em ponta, já que a etapa final é um valor e não um fim.
   */
  const larguras = stages.map((etapa) =>
    Math.max(PISO, escalaDaLargura(etapa.value, maior) * BOCA),
  );
  const alturaDaFaixa = caixa.altura / Math.max(stages.length, 1);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
      <div className="relative flex min-h-[420px] flex-col overflow-hidden rounded-overlay border border-line bg-surface-sunken">
        {/* A grade some sob o funil e aparece nas bordas: dá régua ao gráfico
            sem competir com a forma. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] [background-size:32px_32px]"
        />
        {/* O padding fica no pai: o `inset-0` do SVG ignora padding, e medir o
            elemento acolchoado fazia a última faixa terminar rente à borda. */}
        {/*
          O funil vive numa coluna ESTREITA e centrada, não na largura do cartão.
          Funil é forma retrato: espalhado por 1.300px, a primeira faixa vira uma
          asa de 1.200px de ponta a ponta e o desenho lê como arraia, não como
          funil. O limite de 380px dá a proporção certa e ainda abre espaço à
          direita para os números das faixas finas.
        */}
        <div aria-hidden className="relative flex-1 px-4 py-6 sm:px-8">
          <div className="relative mx-auto h-full w-full max-w-[380px]" ref={moldura}>
            {caixa.largura > 0 && caixa.altura > 0 ? (
              <>
                <svg
                  className="absolute inset-0 h-full w-full overflow-visible"
                  preserveAspectRatio="none"
                  role="presentation"
                  viewBox={`0 0 ${caixa.largura} ${caixa.altura}`}
                >
                  {stages.map((etapa, indice) => (
                    <Faixa
                      altura={alturaDaFaixa}
                      ativa={ativo === indice}
                      apagada={ativo !== null && ativo !== indice}
                      cor={DEGRAUS[indice] ?? DEGRAUS.at(-1)!}
                      de={larguras[indice]!}
                      indice={indice}
                      key={etapa.key}
                      largura={caixa.largura}
                      para={larguras[indice + 1] ?? larguras[indice]!}
                      parado={parado}
                    />
                  ))}
                </svg>

                {/*
                  O NÚMERO na faixa, que é o que a largura não consegue dizer.
                  Com 5, 1, 1, 0 e 0 todas no piso, as cinco faixas de baixo têm
                  exatamente o mesmo desenho — sem o número escrito, o gráfico
                  não distingue uma etapa que ainda tem gente de uma que zerou.

                  Fica DENTRO da faixa, em branco, quando há largura para ele; e
                  ao lado, em tinta, quando não há. É a mesma informação nos dois
                  casos, mudando só onde cabe.
                */}
                {stages.map((etapa, indice) => {
                  const meia =
                    (((larguras[indice]! + (larguras[indice + 1] ?? larguras[indice]!)) / 2) *
                      caixa.largura) /
                    2;
                  const cabeDentro = meia * 2 > 88;
                  return (
                    <span
                      className={cn(
                        "pointer-events-none absolute -translate-y-1/2 text-title tabular transition-opacity duration-200",
                        cabeDentro
                          ? "-translate-x-1/2 text-white"
                          : "translate-x-3 text-ink drop-shadow-[0_1px_0_var(--color-surface-sunken)]",
                        ativo !== null && ativo !== indice ? "opacity-35" : "opacity-100",
                      )}
                      key={etapa.key}
                      style={{
                        top: (indice + 0.5) * alturaDaFaixa,
                        left: cabeDentro ? "50%" : `calc(50% + ${meia}px)`,
                      }}
                    >
                      {etapa.value.toLocaleString("pt-BR")}
                    </span>
                  );
                })}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        A lista é a REPRESENTAÇÃO ACESSÍVEL do gráfico, e não um apêndice dele.
        A silhueta ao lado é `aria-hidden` de propósito: rótulo dentro de uma
        faixa de 7% não cabe em tela nenhuma, e repetir o texto nos dois lugares
        faria o leitor de tela ouvir a jornada duas vezes. Aqui está tudo — nome,
        número exato e queda para a etapa anterior — e é daqui que sai o destaque
        no desenho.
      */}
      <ol className="space-y-2">
        {stages.map((etapa, indice) => (
          <li className="relative" key={etapa.key}>
            {indice > 0 ? (
              <ArrowDown
                aria-hidden
                className="absolute -top-3 left-5 z-10 size-4 rounded-full bg-surface-raised p-0.5 text-ink-tertiary"
              />
            ) : null}
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-card border bg-surface-raised px-4 py-3 text-left shadow-card transition-colors",
                ativo === indice ? "border-accent/45" : "border-line",
              )}
              onBlur={() => setAtivo(null)}
              onFocus={() => setAtivo(indice)}
              onMouseEnter={() => setAtivo(indice)}
              onMouseLeave={() => setAtivo(null)}
              type="button"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: DEGRAUS[indice] ?? DEGRAUS.at(-1) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-label text-ink">{etapa.label}</span>
                {indice > 0 ? (
                  <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-secondary">
                    <TrendingDown aria-hidden className="size-3" />
                    {etapa.conversion.toFixed(1).replace(".", ",")}% da etapa anterior
                  </span>
                ) : (
                  <span className="text-caption text-ink-secondary">Base do período</span>
                )}
              </span>
              <strong className="text-title tabular text-ink">
                {etapa.value.toLocaleString("pt-BR")}
              </strong>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
