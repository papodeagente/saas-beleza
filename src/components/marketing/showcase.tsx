"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BrowserFrame } from "./primitives";

/**
 * As telas reais do produto, trocadas por abas.
 *
 * São capturas do sistema rodando, não desenho de tela: é a única prova que
 * uma landing de software consegue dar antes de existir cliente para depor. Por
 * isso a moldura mostra a URL de cada tela — o leitor sabe exatamente onde
 * aquilo fica.
 *
 * Sem rotação automática. Carrossel que anda sozinho tira do leitor o controle
 * de olhar o que interessa, e aqui cada aba responde a uma dúvida diferente.
 */

const TELAS = [
  {
    id: "hoje",
    aba: "Hoje",
    url: "agendadeunha.com.br/hoje",
    titulo: "O dia inteiro em três segundos",
    texto:
      "Quantos atendimentos, quanto está previsto entrar, quem ainda não confirmou e o que precisa da sua atenção agora.",
  },
  {
    id: "agenda",
    aba: "Agenda",
    url: "agendadeunha.com.br/agenda",
    titulo: "Uma agenda que recusa horário impossível",
    texto:
      "Intervalo entre atendimentos, folga, bloqueio e sala ocupada saem da conta antes de o horário ser oferecido.",
  },
  {
    id: "inbox",
    aba: "Inbox",
    url: "agendadeunha.com.br/inbox",
    titulo: "A conversa e a ficha da cliente lado a lado",
    texto:
      "A atendente responde, vê o histórico e marca o horário na mesma tela, sem pedir o que a clínica já sabe.",
  },
  {
    id: "agente",
    aba: "Agente de IA",
    url: "agendadeunha.com.br/agente",
    titulo: "Você decide o que a IA pode fazer",
    texto:
      "Cada ação do agente liga e desliga separadamente, e tudo que ele fez fica registrado com autoria.",
  },
  {
    id: "financeiro",
    aba: "Financeiro",
    url: "agendadeunha.com.br/financeiro",
    titulo: "O mês fechado sem planilha",
    texto:
      "Receita por serviço, contas a pagar e a comissão de cada profissional, calculada a partir do atendimento.",
  },
  {
    id: "clientes",
    aba: "Clientes",
    url: "agendadeunha.com.br/clientes",
    titulo: "A ficha que a recepção consulta em pé",
    texto: "Histórico, faltas, preferências e quando é hora de chamar de volta.",
  },
  {
    id: "catalogo",
    aba: "Catálogo",
    url: "agendadeunha.com.br/catalogo",
    titulo: "Preço, duração, custo e margem",
    texto:
      "O catálogo define quanto tempo cada serviço ocupa na agenda e quanto ele deixa de verdade.",
  },
] as const;

export function ProductShowcase() {
  const [ativa, setAtiva] = useState<(typeof TELAS)[number]["id"]>("hoje");
  const tela = TELAS.find((t) => t.id === ativa) ?? TELAS[0];

  return (
    <div>
      {/* No celular a lista rola na horizontal em vez de quebrar em quatro
          linhas de pílulas, que empurraria o print para fora da tela. */}
      <div
        role="tablist"
        aria-label="Telas do produto"
        className="-mx-[clamp(20px,4vw,32px)] flex gap-2 overflow-x-auto px-[clamp(20px,4vw,32px)] pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:justify-center md:px-0"
      >
        {TELAS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`aba-${t.id}`}
            aria-selected={t.id === ativa}
            aria-controls={`painel-${t.id}`}
            onClick={() => setAtiva(t.id)}
            className={cn(
              "shrink-0 rounded-pill px-4 py-2 text-label transition-colors duration-150",
              t.id === ativa
                ? "bg-accent-lift/15 font-semibold text-accent-lift"
                : "text-night-ink-secondary hover:bg-white/6 hover:text-night-ink",
            )}
          >
            {t.aba}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`painel-${tela.id}`}
        aria-labelledby={`aba-${tela.id}`}
        className="mt-8"
      >
        <div className="mx-auto max-w-[720px] text-center">
          <h3 className="text-quote text-night-ink">{tela.titulo}</h3>
          <p className="mt-2 text-body text-night-ink-secondary">{tela.texto}</p>
        </div>

        <BrowserFrame url={tela.url} className="mx-auto mt-7 max-w-[1080px]">
          {/* Os sete prints têm exatamente 1600x1000. Fixar a proporção aqui
              impede o salto de layout ao trocar de aba. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- os sete prints
              já saem daqui em WebP de 1600px (316KB somados). Passar por next/image
              exigiria o sharp em runtime, que não está declarado no package.json e
              não é rastreado para o bundle standalone do Docker: a otimização
              falharia no contêiner, não aqui. */}
          <img
            src={`/landing/${tela.id}.webp`}
            alt={`Tela ${tela.aba} da Agenda de Unha`}
            width={1600}
            height={1000}
            loading="lazy"
            decoding="async"
            className="block aspect-[8/5] w-full object-cover object-top"
          />
        </BrowserFrame>
      </div>
    </div>
  );
}
