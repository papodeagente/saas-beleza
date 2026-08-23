import Link from "next/link";
import { Ciclo } from "@/components/marketing/ciclo";
import { Faq, type Pergunta } from "@/components/marketing/faq";
import { MarketingNav } from "@/components/marketing/nav";
import { Pricing } from "@/components/marketing/pricing";
import {
  ArrowRight,
  BrowserFrame,
  CONTAINER,
  CtaButton,
  Eyebrow,
  SECTION_PAD,
  SectionHead,
} from "@/components/marketing/primitives";
import { Reveal } from "@/components/marketing/reveal";
import { ProductShowcase } from "@/components/marketing/showcase";
import { BrandLogo } from "@/components/brand";
import { cn } from "@/lib/utils";
import { listPublicPlans, planCta } from "@/server/services/public-plans";

/**
 * A landing.
 *
 * Estática com revalidação: o único dado vivo são os planos, e eles mudam
 * quando alguém edita o catálogo no painel da plataforma (que já dispara
 * revalidação). Nada aqui consulta sessão — ver o comentário do layout.
 */
export const revalidate = 300;

const RECURSOS = [
  {
    titulo: "Agenda que recusa horário impossível",
    texto:
      "Intervalo entre atendimentos, folga, bloqueio e sala ocupada saem da conta antes de qualquer horário ser oferecido. E o banco de dados barra o choque na hora de salvar, mesmo com dois cliques ao mesmo tempo.",
  },
  {
    titulo: "Link de agendamento que a cliente usa sozinha",
    texto:
      "Você põe na bio e no story. Ela escolhe serviço, profissional e horário, e o horário já aparece marcado na sua agenda.",
  },
  {
    titulo: "Inbox com a ficha da cliente do lado",
    texto:
      "A atendente responde, vê o histórico e marca o horário na mesma tela. Áudio da cliente vira texto antes de chegar.",
  },
  {
    titulo: "Financeiro que fecha o mês sozinho",
    texto:
      "Receita por serviço, contas a pagar e comissão por profissional, calculadas a partir do atendimento que aconteceu.",
  },
  {
    titulo: "Ficha da cliente que a recepção consulta em pé",
    texto:
      "Histórico, faltas, preferências e quando é hora de chamar de volta. Sem perguntar o que a clínica já sabe.",
  },
  {
    titulo: "Cada pessoa vê o que o cargo dela permite",
    texto:
      "Recepção não abre financeiro nem comissão de colega. Toda alteração fica registrada com autor, inclusive quando quem agiu foi a IA.",
  },
];

const AGENTE_FAZ = [
  "Responde no seu WhatsApp a qualquer hora, inclusive de madrugada e no domingo",
  "Consulta o catálogo antes de falar preço e duração",
  "Consulta a agenda antes de oferecer horário, e oferece só o que está livre naquele instante",
  "Marca, remarca e cancela pelo mesmo caminho que a recepção usa",
  "Entende áudio, porque a mensagem de voz vira texto antes de chegar nele",
];

const AGENTE_NAO_FAZ = [
  "Não inventa preço: se o serviço não está no catálogo, ele diz que vai confirmar",
  "Não promete horário que não existe, porque não é ele quem decide o que está livre",
  "Não cria política de cancelamento nem desconto por conta própria",
  "Não continua falando quando você assume a conversa: um toque e ele para",
];

const COMPARATIVO = [
  {
    antes: "A cliente manda mensagem às 22h e recebe resposta às 10h do dia seguinte. Metade some no caminho.",
    depois: "Ela recebe resposta na hora, escolhe o horário e sai marcada.",
  },
  {
    antes: "A agenda está no caderno, no Google e na cabeça da recepção. De vez em quando marca duas na mesma hora.",
    depois: "Uma agenda só, e o sistema recusa o horário duplicado antes de salvar.",
  },
  {
    antes: "Você pergunta no grupo se a Paula está livre quinta.",
    depois: "O horário livre já sai calculado, com intervalo, folga e sala considerados.",
  },
  {
    antes: "No fim do mês você monta a comissão de cada uma na planilha.",
    depois: "A comissão nasce do atendimento e o mês fecha sozinho.",
  },
  {
    antes: "Para saber quanto entrou, você soma as maquininhas.",
    depois: "Receita por serviço, por profissional e por unidade, no mesmo lugar.",
  },
];

const PERGUNTAS: Pergunta[] = [
  {
    pergunta: "Os dados das minhas clientes ficam seguros? E a LGPD?",
    resposta: (
      <>
        Os dados de uma clínica nunca aparecem para outra, e essa separação é feita no banco de
        dados, não só na tela. Cada pessoa da equipe vê apenas o que o cargo dela permite: recepção
        não abre financeiro nem comissão de colega. Toda alteração em um atendimento fica registrada
        com autor, inclusive quando quem agiu foi a IA. No agendamento pelo link, a autorização para
        receber mensagem de divulgação é uma caixa separada da confirmação do horário. Se você pedir
        para exportar ou apagar os dados, a gente exporta e apaga.
      </>
    ),
  },
  {
    pergunta: "Preciso de um número de WhatsApp novo?",
    resposta: (
      <>
        Não. A Agenda de Unha conecta o número que seu espaço já usa, com as conversas que já existem lá. A
        conexão é feita lendo um QR Code, como no WhatsApp Web.
      </>
    ),
  },
  {
    pergunta: "E se eu não quiser que a IA fale com as minhas clientes?",
    resposta: (
      <>
        Ela vem desligada. Você liga quando quiser, escolhe exatamente quais ações ela pode executar
        e pode deixá-la só no modo de teste, respondendo apenas para você, até confiar. Em qualquer
        conversa, um toque assume o controle e o agente para na hora.
      </>
    ),
  },
  {
    pergunta: "Como faço para migrar do que eu uso hoje?",
    resposta: (
      <>
        Na chamada de configuração a gente cadastra junto com você as profissionais, os serviços com
        duração e preço, os horários de trabalho e as salas. Se você tiver a lista de clientes em
        planilha, ela entra de uma vez. O que já estiver marcado na agenda antiga você continua
        atendendo normalmente enquanto a nova enche.
      </>
    ),
  },
  {
    pergunta: "Quantas pessoas podem usar?",
    resposta: (
      <>
        Todas as da sua clínica. O preço é por clínica, não por usuário: proprietária, recepção e
        cada profissional têm o próprio acesso, sem custo adicional. Mais de uma unidade também cabe
        no mesmo plano.
      </>
    ),
  },
  {
    pergunta: "Como funciona o teste de 14 dias?",
    resposta: (
      <>
        Você cria a conta sem cartão de crédito e usa o sistema inteiro, sem recurso bloqueado. No
        fim dos 14 dias, se não quiser continuar, não precisa fazer nada: o acesso simplesmente
        encerra e nada é cobrado.
      </>
    ),
  },
  {
    pergunta: "Posso cancelar quando quiser?",
    resposta: (
      <>
        Pode, sem multa e sem fidelidade. O acesso continua até o fim do período que você já pagou. E
        os dados são seus: a gente exporta suas clientes e seus atendimentos antes de você sair.
      </>
    ),
  },
  {
    pergunta: "Que suporte eu tenho?",
    resposta: (
      <>
        Suporte por WhatsApp, falando direto com quem faz o produto. Somos novos, e é justamente por
        isso que você tem acesso a quem escreve o sistema em vez de a um formulário de chamado.
      </>
    ),
  },
];

export default async function LandingPage() {
  const planos = await listPublicPlans();
  const principal = planos[0];

  // O botão do topo e o do fim seguem a mesma precedência do cartão de preço:
  // checkout quando existe link, teste grátis quando não existe. É isso que
  // impede a página de exibir um botão morto enquanto a cobrança não está no ar.
  const ctaTopo = principal
    ? planCta(principal, "monthly")
    : { kind: "trial" as const, href: "/entrar", label: "Entrar" };

  return (
    <>
      {/* O rótulo curto acompanha o destino: com link de checkout o botão do
          topo levaria à compra dizendo "teste", que é promessa trocada. */}
      <MarketingNav
        ctaHref={ctaTopo.href}
        ctaLabel={ctaTopo.kind === "checkout" ? "Assinar" : "Começar o teste"}
      />

      {/* Fundo global: uma grade discreta com máscara e dois halos fora da
          viewport. Zero imagem, zero JavaScript, profundidade em toda a rolagem. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-night-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-night-line) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(ellipse 80% 55% at 50% 0%, #000 20%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 55% at 50% 0%, #000 20%, transparent 75%)",
          }}
        />
        <div className="absolute -left-[10%] -top-[15%] size-[720px] rounded-pill bg-night-glow/20 blur-[140px]" />
        <div className="absolute -right-[12%] top-[8%] size-[560px] rounded-pill bg-[#8744cd]/20 blur-[140px]" />
      </div>

      <main className="relative z-10">
        {/* ------------------------------------------------------------------ */}
        {/* Hero                                                                */}
        {/* ------------------------------------------------------------------ */}
        <section className={cn(SECTION_PAD, "pt-[calc(72px+clamp(48px,7vw,88px))]")}>
          <div
            className={cn(
              CONTAINER,
              "grid items-center gap-[clamp(40px,5vw,72px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
            )}
          >
            <div>
              <span className="animate-rise-in inline-block [animation-delay:0ms]">
                <Eyebrow>Sistema para clínicas de estética</Eyebrow>
              </span>

              <h1 className="animate-rise-in mt-6 text-balance text-hero text-night-ink [animation-delay:80ms]">
                Sua clínica atendendo no WhatsApp enquanto você atende na cadeira
              </h1>

              <p className="animate-rise-in mt-6 max-w-[54ch] text-pretty text-lede text-night-ink-secondary [animation-delay:180ms]">
                A Agenda de Unha responde a cliente, consulta a agenda de verdade e marca o horário sozinha.
                Do primeiro oi até o caixa do mês, tudo acontece no mesmo sistema.
              </p>

              <div className="animate-rise-in mt-8 flex flex-wrap gap-3 [animation-delay:260ms]">
                <CtaButton href={ctaTopo.href} external={ctaTopo.kind === "checkout"}>
                  {ctaTopo.label}
                  <ArrowRight />
                </CtaButton>
                <CtaButton href="#produto" variant="ghost">
                  Ver o produto por dentro
                </CtaButton>
              </div>

              {/* Prova honesta: o que dá para verificar hoje. Sem nota inventada,
                  sem "mais de 500 clínicas", sem logotipo de quem não é cliente. */}
              {/* Os separadores nascem da lista, não são escritos à mão: sem o
                  plano carregado o primeiro item some, e um traço solto no
                  começo da linha denunciaria o buraco. */}
              <ul className="animate-rise-in mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-night-ink-tertiary [animation-delay:340ms]">
                {[
                  principal ? `${principal.trialDays} dias de teste, sem cartão` : null,
                  "Um plano só, sem cobrança por usuário",
                  "Configuração feita junto com você",
                ]
                  .filter((item): item is string => Boolean(item))
                  .map((item, i) => (
                    <li key={item} className="flex items-center gap-3">
                      {i > 0 ? (
                        <span aria-hidden className="h-3 w-px bg-night-line-strong" />
                      ) : null}
                      <span className={i === 0 ? "text-night-ink-secondary" : undefined}>
                        {item}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            {/* A entrada girada é gesto de desktop. No celular ela apenas
                aparece: animar rotação de um elemento grande com desfoque atrás
                é o pior caso de repaint justamente onde está a maior parte do
                tráfego. */}
            <div className="animate-fade-in mockup-tilt [animation-delay:200ms] lg:animate-mockup-in">
              <BrowserFrame url="app.lumina.com.br/hoje">
          {/* eslint-disable-next-line @next/next/no-img-element -- os sete prints
              já saem daqui em WebP de 1600px (316KB somados). Passar por next/image
              exigiria o sharp em runtime, que não está declarado no package.json e
              não é rastreado para o bundle standalone do Docker: a otimização
              falharia no contêiner, não aqui. */}
                <img
                  src="/landing/hoje.webp"
                  alt="A tela Hoje da Agenda de Unha, com os atendimentos do dia e o que precisa de atenção"
                  width={1600}
                  height={1000}
                  fetchPriority="high"
                  decoding="async"
                  className="block aspect-[8/5] w-full object-cover object-top"
                />
              </BrowserFrame>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* O ciclo — assinatura da página                                      */}
        {/* ------------------------------------------------------------------ */}
        <section className={cn(SECTION_PAD, "border-t border-night-line bg-night-sunken/60")}>
          <div className={CONTAINER}>
            <SectionHead
              eyebrow="Como funciona"
              title="Não é uma agenda com WhatsApp colado do lado"
              description="É um circuito fechado. A mensagem entra, o horário fecha, o atendimento acontece, o dinheiro entra e a cliente volta. Cada estação alimenta a próxima porque todas leem os mesmos dados."
            />
            <Ciclo />
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Produto ao vivo                                                     */}
        {/* ------------------------------------------------------------------ */}
        <section id="produto" className={cn(SECTION_PAD, "scroll-mt-[72px]")}>
          <div className={CONTAINER}>
            <SectionHead
              eyebrow="Por dentro"
              title="O produto, como ele é hoje"
              description="Não são telas de demonstração desenhadas para a propaganda. São capturas do sistema rodando."
            />
            <div className="mt-12">
              <ProductShowcase />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Recursos                                                            */}
        {/* ------------------------------------------------------------------ */}
        <section className={cn(SECTION_PAD, "border-t border-night-line")}>
          <div className={CONTAINER}>
            <SectionHead
              eyebrow="O que vem junto"
              title="O dia inteiro da clínica sem trocar de tela"
            />
            <ul className="mt-12 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {RECURSOS.map((r, i) => (
                <Reveal as="li" key={r.titulo} delay={(i % 3) * 80}>
                  <h3 className="text-card text-night-ink">{r.titulo}</h3>
                  <p className="mt-2 text-body leading-relaxed text-night-ink-secondary">{r.texto}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Agente de IA                                                        */}
        {/* ------------------------------------------------------------------ */}
        <section
          id="agente"
          className={cn(SECTION_PAD, "scroll-mt-[72px] border-t border-night-line bg-night-sunken/60")}
        >
          <div className={CONTAINER}>
            <SectionHead
              eyebrow="Agente de IA"
              title="Uma atendente que não dorme e não inventa"
              description="A maioria dos robôs de WhatsApp chuta preço e promete horário que não existe. O agente da Agenda de Unha não consegue fazer isso: ele consulta o sistema a cada resposta."
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              <Reveal className="rounded-overlay border border-night-line-strong bg-night-raised p-7">
                <h3 className="text-card text-night-ink">O que ele faz</h3>
                <ul className="mt-5 space-y-3">
                  {AGENTE_FAZ.map((item) => (
                    <li key={item} className="flex gap-3">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-1 size-3.5 shrink-0 text-accent-lift"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <span className="text-body text-night-ink-secondary">{item}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal
                delay={100}
                className="rounded-overlay border border-night-line-strong bg-night-raised p-7"
              >
                <h3 className="text-card text-night-ink">O que ele nunca faz</h3>
                <ul className="mt-5 space-y-3">
                  {AGENTE_NAO_FAZ.map((item) => (
                    <li key={item} className="flex gap-3">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        className="mt-1 size-3.5 shrink-0 text-night-ink-tertiary"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                      <span className="text-body text-night-ink-secondary">{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 border-t border-night-line pt-5 text-caption leading-relaxed text-night-ink-tertiary">
                  Quando ele não tem certeza, ele diz que vai confirmar e chama uma pessoa. Preferir
                  o silêncio ao palpite é uma decisão de projeto, não uma limitação.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Comparativo                                                         */}
        {/* ------------------------------------------------------------------ */}
        <section className={cn(SECTION_PAD, "border-t border-night-line")}>
          <div className={CONTAINER}>
            <SectionHead eyebrow="Antes e depois" title="O mesmo dia, de dois jeitos" />

            <div className="mx-auto mt-12 max-w-[980px]">
              <div className="hidden grid-cols-2 gap-6 pb-3 md:grid">
                <span className="text-eyebrow text-night-ink-tertiary">Como é hoje</span>
                <span className="text-eyebrow text-accent-lift">Com a Agenda de Unha</span>
              </div>

              <ul className="divide-y divide-night-line border-t border-night-line">
                {COMPARATIVO.map((linha, i) => (
                  <Reveal as="li" key={linha.antes} delay={i * 60} className="grid gap-3 py-5 md:grid-cols-2 md:gap-6">
                    <p className="text-body text-night-ink-tertiary md:pr-6">
                      <span className="mr-2 text-eyebrow text-night-ink-tertiary md:hidden">
                        Hoje
                      </span>
                      {linha.antes}
                    </p>
                    <p className="text-body text-night-ink md:pl-6">
                      <span className="mr-2 text-eyebrow text-accent-lift md:hidden">Agenda de Unha</span>
                      {linha.depois}
                    </p>
                  </Reveal>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Preço                                                               */}
        {/* ------------------------------------------------------------------ */}
        <section
          id="preco"
          className={cn(SECTION_PAD, "scroll-mt-[72px] border-t border-night-line bg-night-sunken/60")}
        >
          <div className={CONTAINER}>
            <SectionHead
              eyebrow="Preço"
              title="Um plano, sem faixa escondida"
              description="Sem taxa de implantação, sem cobrança por usuário e sem o recurso que você precisa trancado num plano mais caro."
            />
            <div className="mt-10">
              <Pricing
                plans={planos.map((plan) => ({
                  plan,
                  cta: { monthly: planCta(plan, "monthly"), yearly: planCta(plan, "yearly") },
                }))}
              />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Perguntas                                                           */}
        {/* ------------------------------------------------------------------ */}
        <section id="perguntas" className={cn(SECTION_PAD, "scroll-mt-[72px] border-t border-night-line")}>
          <div className={CONTAINER}>
            <SectionHead eyebrow="Perguntas" title="O que costumam perguntar antes de assinar" />
            <div className="mt-12">
              <Faq itens={PERGUNTAS} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Fechamento — o gradiente que abre o login                           */}
        {/* ------------------------------------------------------------------ */}
        <section className={cn(SECTION_PAD, "pb-0")}>
          <div className={CONTAINER}>
            <div className="relative overflow-hidden rounded-[32px] bg-brand px-[clamp(28px,5vw,72px)] py-[clamp(48px,6vw,80px)] text-center">
              <div
                aria-hidden
                className="absolute inset-0 opacity-25"
                style={{
                  backgroundImage: "radial-gradient(#fff 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                  maskImage: "radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)",
                  WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 0%, #000, transparent 70%)",
                }}
              />
              <div className="relative">
                <h2 className="mx-auto max-w-[18ch] text-balance text-section-title text-white">
                  Sua próxima cliente já está digitando
                </h2>
                <p className="mx-auto mt-4 max-w-[58ch] text-pretty text-lede text-white">
                  Em quinze minutos de chamada a gente configura sua agenda, seu catálogo e seu link
                  de agendamento. No mesmo dia você começa a atender pelo sistema.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <CtaButton
                    href={ctaTopo.href}
                    external={ctaTopo.kind === "checkout"}
                    className="bg-white text-[#12294f] shadow-none hover:bg-white/90"
                  >
                    {ctaTopo.label}
                    <ArrowRight />
                  </CtaButton>
                  <CtaButton
                    href="/entrar"
                    variant="ghost"
                    className="border-white/35 text-white hover:bg-white/12"
                  >
                    Já sou cliente
                  </CtaButton>
                </div>
                <p className="mt-5 text-caption text-white">
                  {principal ? `${principal.trialDays} dias de teste. ` : ""}
                  Cancele quando quiser. Seus dados saem com você.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Rodapé                                                              */}
        {/* ------------------------------------------------------------------ */}
        <footer className={cn(SECTION_PAD, "pb-10")}>
          <div className={cn(CONTAINER, "border-t border-night-line pt-10")}>
            <div className="flex flex-wrap items-start justify-between gap-8">
              <div className="max-w-[34ch]">
                <BrandLogo className="text-night-ink" />
                <p className="mt-2 text-body text-night-ink-secondary">
                  Gestão inteligente para manicures.
                </p>
              </div>

              {/* Só entra link que existe. Rodapé cheio de href morto é a
                  primeira coisa que denuncia página feita às pressas. */}
              <nav aria-label="Rodapé" className="flex flex-wrap gap-x-12 gap-y-6">
                <div>
                  <p className="text-eyebrow text-night-ink-tertiary">Produto</p>
                  <ul className="mt-3 space-y-2">
                    {[
                      { href: "#produto", label: "Por dentro" },
                      { href: "#agente", label: "Agente de IA" },
                      { href: "#preco", label: "Preço" },
                      { href: "#perguntas", label: "Perguntas" },
                    ].map((l) => (
                      <li key={l.href}>
                        <a
                          href={l.href}
                          className="text-body text-night-ink-secondary transition-colors hover:text-night-ink"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-eyebrow text-night-ink-tertiary">Acesso</p>
                  <ul className="mt-3 space-y-2">
                    <li>
                      <Link
                        href="/entrar"
                        className="text-body text-night-ink-secondary transition-colors hover:text-night-ink"
                      >
                        Entrar
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={ctaTopo.kind === "trial" ? ctaTopo.href : "/criar-conta"}
                        className="text-body text-night-ink-secondary transition-colors hover:text-night-ink"
                      >
                        Criar conta
                      </Link>
                    </li>
                  </ul>
                </div>
              </nav>
            </div>

            <p className="mt-10 text-caption text-night-ink-tertiary">
              Agenda de Unha · Gestão inteligente para manicures · Feito no Brasil
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
