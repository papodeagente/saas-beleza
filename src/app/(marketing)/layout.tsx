import type { Metadata } from "next";

/**
 * Casca da página pública.
 *
 * `data-surface="night"` é o que liga o tema escuro, e ele funciona por adição:
 * nenhum token do produto é redefinido aqui. As regras que pintam o chão e
 * corrigem a cor das bordas moram em globals.css, dentro de @layer base — fora
 * dela venceriam as utilities do Tailwind.
 *
 * Este layout NÃO consulta a sessão. Consultar cookies tiraria a página do
 * cache estático e faria cada visita anônima custar uma consulta ao banco, na
 * rota que mais recebe tráfego e menos precisa do banco. Quem já tem sessão
 * clica em "Entrar" e a própria tela de login o encaminha para dentro.
 */

const DESCRICAO =
  "Agenda, WhatsApp com atendimento por IA, ficha da cliente e financeiro no mesmo lugar. Um plano só, R$ 97 por mês, com 14 dias de teste.";

/**
 * Na aba, o layout raiz já aplica o gabarito da Agenda de Unha. `absolute` dispensa o
 * gabarito: a home é a única página cujo título deve ser só o da marca.
 */
const TITULO = "Agenda de Unha — gestão inteligente para manicures";

export const metadata: Metadata = {
  title: { absolute: TITULO },
  description: DESCRICAO,
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    type: "website",
    locale: "pt_BR",
    siteName: "Agenda de Unha",
  },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRICAO },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="night" className="min-h-dvh overflow-x-clip bg-night text-night-ink">
      {children}
    </div>
  );
}
