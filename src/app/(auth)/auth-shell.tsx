/**
 * Moldura das telas de autenticação.
 *
 * A landing pública termina numa faixa com o gradiente da marca; o login abre
 * com a MESMA faixa. Quem vem do site atravessa a porta sem sentir que trocou
 * de produto — e o gradiente que recebe aqui é o mesmo que vai ficar no alto do
 * painel depois de entrar (`AppShell`), então a marca não muda três vezes em
 * dois cliques.
 *
 * Contraste medido sobre o gradiente (#3f6be8 → #12749a, 21 amostras): branco
 * puro dá 4.69:1 no topo e 5.26:1 na base. Qualquer opacidade abaixo de 100%
 * reprova (branco a 92% já cai para 4.23:1), por isso NENHUM texto deste painel
 * usa `text-white/xx` — a hierarquia sai de tamanho e peso, não de transparência.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(320px,36%)_1fr]">
      {/*
        No celular vira só uma faixa: metade da tela em gradiente empurraria o
        formulário para baixo da dobra, e quem abre o login quer o campo de
        e-mail, não a promessa da marca.
      */}
      <aside className="bg-brand flex shrink-0 flex-col justify-between gap-10 px-6 py-5 lg:px-10 lg:py-10">
        {/* Mesmo lockup da barra do painel, letra por letra. */}
        <BrandLogo compact variant="white" />

        <div className="hidden lg:block">
          <p className="max-w-[20ch] text-display text-white">
            Agenda, WhatsApp e caixa do seu espaço no mesmo lugar.
          </p>
          <p className="mt-3 max-w-[34ch] text-body text-white">
            Gestão inteligente para manicures que vivem de agenda cheia.
          </p>
        </div>
      </aside>

      {/* No celular o formulário encosta na faixa: centralizar verticalmente
          empurrava o campo de e-mail para o meio da tela, com 300px de vazio
          acima dele. No desktop a coluna é alta e a centralização volta. */}
      <main className="flex flex-1 items-start justify-center px-6 py-10 lg:items-center lg:py-12">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
    </div>
  );
}
import { BrandLogo } from "@/components/brand";
