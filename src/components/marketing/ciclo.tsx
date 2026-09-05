import { Reveal } from "./reveal";

/**
 * O ciclo — a peça de assinatura da página.
 *
 * A tese do produto não é "temos agenda e temos financeiro". É que essas coisas
 * são estações de um circuito único, e que o circuito FECHA: o dinheiro que
 * entra alimenta o retorno da cliente, que começa tudo de novo. Uma grade de
 * seis cartões soltos diria a coisa errada sobre o produto.
 *
 * O movimento é só de entrada, escalonado estação por estação. Nada aqui anima
 * continuamente: o desenho já carrega a ideia, e animação em laço numa página
 * de venda cansa antes de convencer.
 */

const ESTACOES = [
  { n: "01", titulo: "A cliente chama", texto: "Mensagem no WhatsApp, a qualquer hora." },
  { n: "02", titulo: "A IA responde", texto: "Consulta catálogo e agenda antes de falar." },
  { n: "03", titulo: "O horário fecha", texto: "Marcado na mesma agenda da recepção." },
  { n: "04", titulo: "O atendimento acontece", texto: "Com ficha, histórico e profissional certos." },
  { n: "05", titulo: "O pagamento entra", texto: "Receita e comissão nascem do atendimento." },
  { n: "06", titulo: "O retorno é lembrado", texto: "A clínica sabe quando chamar de volta." },
];

export function Ciclo() {
  return (
    <div className="mt-14">
      {/* Desktop: seis estações sobre um trilho contínuo. */}
      <div className="relative hidden lg:block">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-[26px] h-px bg-gradient-to-r from-transparent via-accent-lift/45 to-transparent"
        />
        <ol className="relative grid grid-cols-6 gap-4">
          {ESTACOES.map((e, i) => (
            <Reveal as="li" key={e.n} delay={i * 90}>
              <span
                aria-hidden
                className="flex size-[52px] items-center justify-center rounded-pill border border-night-line-strong bg-night text-label font-bold tabular text-accent-lift"
              >
                {e.n}
              </span>
              <h3 className="mt-4 text-card text-night-ink">{e.titulo}</h3>
              <p className="mt-1 text-caption leading-5 text-night-ink-secondary">{e.texto}</p>
            </Reveal>
          ))}
        </ol>

        {/* O arco de volta é o argumento inteiro: sem ele, isto seria uma fila
            de tarefas em vez de um ciclo. */}
        <div aria-hidden className="relative mt-8 h-16">
          <svg
            viewBox="0 0 1200 64"
            preserveAspectRatio="none"
            className="h-full w-full"
            fill="none"
          >
            <path
              d="M1100 0 C1100 46, 1060 56, 980 56 L220 56 C140 56, 100 46, 100 0"
              stroke="var(--color-accent-lift)"
              strokeOpacity="0.35"
              strokeWidth="1.5"
              strokeDasharray="5 6"
            />
          </svg>
          <span className="absolute left-1/2 top-[38px] -translate-x-1/2 bg-night px-4 text-caption text-night-ink-tertiary">
            e a cliente volta
          </span>
        </div>
      </div>

      {/* Celular: o mesmo circuito em pé, com o trilho à esquerda. */}
      <ol className="relative space-y-7 lg:hidden">
        <div
          aria-hidden
          className="absolute bottom-6 left-[25px] top-6 w-px bg-gradient-to-b from-accent-lift/45 via-accent-lift/25 to-transparent"
        />
        {ESTACOES.map((e, i) => (
          <Reveal as="li" key={e.n} delay={i * 70} className="relative flex gap-4">
            <span
              aria-hidden
              className="flex size-[52px] shrink-0 items-center justify-center rounded-pill border border-night-line-strong bg-night text-label font-bold tabular text-accent-lift"
            >
              {e.n}
            </span>
            <span className="pt-2.5">
              <h3 className="text-card text-night-ink">{e.titulo}</h3>
              <p className="mt-1 text-caption leading-5 text-night-ink-secondary">{e.texto}</p>
            </span>
          </Reveal>
        ))}
        <li className="relative flex gap-4 pt-1">
          <span
            aria-hidden
            className="flex size-[52px] shrink-0 items-center justify-center rounded-pill border border-dashed border-accent-lift/40 bg-night text-accent-lift"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
            </svg>
          </span>
          <span className="pt-3.5 text-caption text-night-ink-tertiary">e a cliente volta</span>
        </li>
      </ol>
    </div>
  );
}
