"use client";

import {
  CalendarDays,
  Check,
  Clock,
  Copy,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  Sparkles,
  Store,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  bandeiraDoCartao,
  cpfValido,
  formatarCep,
  formatarCpf,
  formatarNumeroDoCartao,
  formatarValidade,
  lerValidade,
  numeroDeCartaoPlausivel,
} from "@/domain/documento";
import { copyToClipboard } from "@/lib/clipboard";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CheckoutDaReserva, PixParaPagar } from "@/server/services/booking-payment-service";
import { conferirPagamentoAction, gerarPixAction, pagarComCartaoAction } from "./actions";

/**
 * O pagamento acontece AQUI.
 *
 * A cliente não é jogada num site que ela não reconhece no meio de um
 * agendamento: o PIX aparece nesta tela, o cartão é digitado nesta tela, e a
 * confirmação muda esta tela. É também o endereço que o WhatsApp manda, então
 * é uma página que precisa fazer sentido aberta sozinha, sem o contexto do
 * agendamento que acabou de acontecer.
 *
 * Três decisões que valem a leitura:
 *
 * 1. **O relógio é o assunto do topo.** Não é um enfeite no canto: é a razão
 *    de a pessoa concluir agora. Ele tem tamanho, barra que drena e um texto
 *    que muda conforme aperta — e nunca inventa pressa, porque o prazo que ele
 *    mostra é o mesmo que o servidor vai cobrar.
 * 2. **A tela pergunta ao servidor se o pagamento caiu, a cada cinco
 *    segundos.** Esperar só pelo webhook do Asaas deixaria a cliente olhando
 *    um QR parado com o dinheiro já na conta da clínica.
 * 3. **O cartão só é enviado depois de Luhn, CPF e validade conferidos aqui.**
 *    Recusa do adquirente é frase feia e assusta; o que dá para pegar antes,
 *    pega-se antes.
 */

const PULSO = 5000;

/** Minutos a partir dos quais o relógio muda de tom. */
const APERTANDO = 5;
const ULTIMOS = 2;

type Contagem = {
  minutos: number;
  segundos: number;
  /** Quanto da janela ainda resta, de 0 a 1. É a barra. */
  fracao: number;
  acabou: boolean;
};

function useContagem(venceEm: string | null, janelaMinutos: number): Contagem {
  const limite = useMemo(() => (venceEm ? new Date(venceEm).getTime() : null), [venceEm]);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (limite === null) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [limite]);

  if (limite === null) return { minutos: 0, segundos: 0, fracao: 0, acabou: false };
  const restante = Math.max(0, limite - agora);
  const janela = Math.max(1, janelaMinutos) * 60_000;
  return {
    minutos: Math.floor(restante / 60_000),
    segundos: Math.floor((restante % 60_000) / 1000),
    fracao: Math.max(0, Math.min(1, restante / janela)),
    acabou: restante <= 0,
  };
}

function relogio(c: Contagem): string {
  return `${String(c.minutos).padStart(2, "0")}:${String(c.segundos).padStart(2, "0")}`;
}

/**
 * O que o relógio diz, além da hora.
 *
 * Muda de recado conforme aperta. A urgência é real — o horário volta mesmo
 * para a agenda —, então ela pode ser dita sem rodeio; o que não se faz é
 * inventar pressa que o servidor não vai cumprir.
 */
function recadoDoRelogio(c: Contagem): string {
  if (c.minutos < ULTIMOS) return "Últimos minutos. Depois disso o horário volta para a agenda.";
  if (c.minutos < APERTANDO) return "O tempo está acabando. Conclua para não perder o horário.";
  return "Seu horário está separado. Conclua o pagamento para confirmar.";
}

/**
 * A cor do relógio.
 *
 * Valores fixos, e não os tokens do produto: `text-attention` e `text-danger`
 * são calibrados para tinta escura sobre fundo claro e somem sobre o roxo do
 * cabeçalho. Estes três são tons claros, escolhidos para ler sobre ele.
 */
function tomDoRelogio(c: Contagem): { texto: string; barra: string } {
  if (c.minutos < ULTIMOS) return { texto: "#FFD1D1", barra: "#FF8A8A" };
  if (c.minutos < APERTANDO) return { texto: "#FFE7B8", barra: "#FFC861" };
  return { texto: "#FFFFFF", barra: "#FFFFFF" };
}

export function CheckoutView({ token, reserva }: { token: string; reserva: CheckoutDaReserva }) {
  const [estado, setEstado] = useState(reserva.estado);
  /** Existe cobrança criada esperando o dinheiro: PIX na tela, ou cartão em análise. */
  const [esperando, setEsperando] = useState(false);
  const contagem = useContagem(
    estado === "aguardando" ? reserva.venceEm : null,
    reserva.janelaMinutos,
  );

  /**
   * A consulta do pagamento mora AQUI, e não no formulário do PIX.
   *
   * A contagem regressiva re-renderiza esta árvore a cada segundo. Um
   * `setInterval` montado lá embaixo, com o callback recebido por prop na
   * lista de dependências, era desmontado e remontado a cada segundo — e um
   * intervalo de cinco segundos que reinicia a cada um nunca dispara. O PIX
   * jamais confirmaria sozinho. Neste componente as dependências são
   * `esperando` e o token, que não mudam com o relógio.
   */
  useEffect(() => {
    if (!esperando || estado !== "aguardando") return;
    const id = setInterval(async () => {
      const { pago } = await conferirPagamentoAction(token);
      if (pago) setEstado("pago");
    }, PULSO);
    return () => clearInterval(id);
  }, [esperando, estado, token]);

  const restanteCents = Math.max(0, reserva.precoCents - reserva.valorCents);
  const vencido = estado === "vencido" || (estado === "aguardando" && contagem.acabou);

  if (estado === "pago") {
    return (
      <Pagina>
        <Capa
          reserva={reserva}
          tom="pago"
          icone={<Check className="size-7" aria-hidden />}
          eyebrow="Pagamento confirmado"
          titulo="Seu horário está confirmado"
          subtitulo={`${reserva.clinica} já recebeu o pagamento. Até logo!`}
        />
        <div className="px-6 py-6 sm:px-9">
          <Resumo reserva={reserva} />
          <p className="mt-5 text-caption text-ink-secondary">
            Não precisa mandar comprovante. Para remarcar ou cancelar, fale com a recepção.
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-caption text-ink-tertiary">
            <ShieldCheck className="size-3.5 shrink-0 text-positive" aria-hidden />
            Pagamento processado e confirmado pelo <MarcaAsaas />
          </p>
          <Rodape clinica={reserva.clinica} />
        </div>
      </Pagina>
    );
  }

  if (vencido) {
    return (
      <Pagina>
        <Capa
          reserva={reserva}
          tom="parado"
          icone={<Clock className="size-7" aria-hidden />}
          eyebrow="Tempo esgotado"
          titulo="Este horário voltou para a agenda"
          subtitulo="O prazo do pagamento passou. É só escolher um horário de novo."
        />
        <div className="px-6 py-6 sm:px-9">
          <Button variant="primary" size="lg" className="w-full" asChild>
            <a href={`/agendar/${reserva.slug}`}>Escolher outro horário</a>
          </Button>
          <div className="mt-5">
            <Resumo reserva={reserva} esmaecido />
          </div>
          <Rodape clinica={reserva.clinica} />
        </div>
      </Pagina>
    );
  }

  if (estado === "estornado") {
    return (
      <Pagina>
        <Capa
          reserva={reserva}
          tom="parado"
          icone={<TriangleAlert className="size-7" aria-hidden />}
          eyebrow="Pagamento estornado"
          titulo="O valor foi devolvido"
          subtitulo={`Fale com ${reserva.clinica} para saber se o atendimento continua de pé.`}
        />
        <div className="px-6 py-6 sm:px-9">
          <Resumo reserva={reserva} esmaecido />
          <Rodape clinica={reserva.clinica} />
        </div>
      </Pagina>
    );
  }

  if (estado === "sem_cobranca") {
    return (
      <Pagina>
        <Capa
          reserva={reserva}
          tom="pago"
          icone={<Check className="size-7" aria-hidden />}
          eyebrow="Tudo certo"
          titulo="Este horário não precisa de pagamento"
          subtitulo={`${reserva.clinica} espera por você.`}
        />
        <div className="px-6 py-6 sm:px-9">
          <Resumo reserva={reserva} />
          <Rodape clinica={reserva.clinica} />
        </div>
      </Pagina>
    );
  }

  return (
    <Pagina contagem={contagem}>
      <Capa
        reserva={reserva}
        tom="cobrando"
        icone={<Lock className="size-7" aria-hidden />}
        eyebrow="Falta o pagamento"
        titulo="Seu horário está guardado"
        subtitulo={`${reserva.clinica} guarda este horário até o pagamento entrar.`}
        contagem={contagem}
      />

      <div className="px-6 py-6 sm:px-9">
        <Valor
          valorCents={reserva.valorCents}
          precoCents={reserva.precoCents}
          restanteCents={restanteCents}
        />

        <Pagamento
          token={token}
          reserva={reserva}
          onPago={() => setEstado("pago")}
          onEsperar={() => setEsperando(true)}
        />

        <div className="mt-6">
          <Resumo reserva={reserva} />
        </div>

        <SeloDeSeguranca clinica={reserva.clinica} />
        <Rodape clinica={reserva.clinica} />
      </div>
    </Pagina>
  );
}

/**
 * A moldura da página e a barra grudenta do relógio.
 *
 * A barra só existe quando há contagem e só aparece quando o relógio do topo
 * sai de vista: numa tela de celular, o formulário do cartão empurra o
 * cabeçalho inteiro para fora, e é exatamente aí que o motivo de concluir
 * agora precisa continuar visível. Quem vê a contagem o tempo todo é quem já
 * rolou a página — não é enfeite, é o gatilho no lugar certo.
 */
function Pagina({
  contagem,
  children,
}: {
  contagem?: Contagem;
  children: React.ReactNode;
}) {
  const sentinela = useRef<HTMLDivElement | null>(null);
  const [grudada, setGrudada] = useState(false);

  /**
   * A sentinela fica no topo da página, e a margem negativa é que decide
   * quando a barra entra: ela passa a "não intersectar" depois de ~240px de
   * rolagem, que é onde o relógio do cabeçalho sai de vista. Observar o
   * próprio relógio exigiria atravessar a árvore com uma ref, e a conta
   * mudaria toda vez que o cabeçalho mudasse de altura.
   */
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || !contagem) return;
    const observador = new IntersectionObserver(
      ([entrada]) => setGrudada(!entrada.isIntersecting),
      { rootMargin: "-240px 0px 0px 0px", threshold: 0 },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [contagem]);

  const tom = contagem ? tomDoRelogio(contagem) : null;

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#f1e5fb_0,transparent_38%),radial-gradient(circle_at_bottom_right,#ede3fb_0,transparent_34%),var(--color-surface)] px-4 py-8 sm:py-14">
      {contagem && tom ? (
        <div
          aria-hidden={!grudada}
          className={cn(
            // `bg-brand` é gradiente, não cor: modificador de opacidade não
            // funciona nele, e a barra é opaca de propósito — texto branco
            // sobre conteúdo rolando por baixo seria ilegível.
            "fixed inset-x-0 top-0 z-30 bg-brand shadow-[0_6px_20px_rgb(67_35_88/0.22)] transition-transform duration-200",
            grudada ? "translate-y-0" : "-translate-y-full",
          )}
        >
          <div className="mx-auto flex max-w-[560px] items-center gap-3 px-5 py-2.5">
            <Clock className="size-4 shrink-0 text-white" aria-hidden />
            <span className="text-caption text-white/85">Horário guardado por</span>
            <span
              className="ml-auto font-mono text-label tabular-nums"
              style={{ color: tom.texto }}
            >
              {relogio(contagem)}
            </span>
          </div>
        </div>
      ) : null}

      <div ref={sentinela} className="pointer-events-none h-px" aria-hidden />
      <div className="mx-auto max-w-[560px] overflow-hidden rounded-overlay bg-surface-raised shadow-[0_28px_80px_rgb(67_35_88/0.16)]">
        {children}
      </div>
    </main>
  );
}

/**
 * O cabeçalho.
 *
 * A marca da clínica vem antes de tudo porque a primeira pergunta de quem
 * abre um link de pagamento é "isto é mesmo do salão que eu marquei?". Depois
 * vem o relógio, que é a razão de concluir agora.
 */
function Capa({
  reserva,
  tom,
  icone,
  eyebrow,
  titulo,
  subtitulo,
  contagem,
}: {
  reserva: CheckoutDaReserva;
  tom: "cobrando" | "pago" | "parado";
  icone: React.ReactNode;
  eyebrow: string;
  titulo: string;
  subtitulo: string;
  contagem?: Contagem;
}) {
  const cor = contagem ? tomDoRelogio(contagem) : null;

  return (
    <header className="relative overflow-hidden bg-brand px-6 pb-7 pt-6 text-white sm:px-9">
      {/* Brilho diagonal: dá profundidade ao gradiente chapado sem pesar. */}
      <div
        className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-pill bg-white/10 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        {reserva.logoUrl ? (
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-pill bg-white ring-2 ring-white/40">
            <img src={reserva.logoUrl} alt="" className="size-full object-cover" />
          </span>
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-white/16 text-label font-semibold text-white ring-1 ring-white/25">
            {reserva.clinica.trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-label text-white">{reserva.clinica}</p>
          <p className="text-caption text-white/80">Agendamento online</p>
        </div>
        <span
          className={cn(
            "ml-auto flex size-11 shrink-0 items-center justify-center rounded-pill ring-1",
            tom === "pago" ? "bg-white/20 ring-white/35" : "bg-white/12 ring-white/25",
          )}
        >
          {icone}
        </span>
      </div>

      <div className="relative mt-6">
        <p className="text-eyebrow text-white">{eyebrow}</p>
        <h1 className="mt-1.5 text-display text-white">{titulo}</h1>
        <p className="mt-2 text-body text-white/90">{subtitulo}</p>
      </div>

      {contagem && cor ? (
        <div className="relative mt-6 rounded-card bg-black/15 px-4 py-3.5 ring-1 ring-white/15">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-caption text-white/85">
                <Clock className="size-3.5" aria-hidden />
                Tempo para garantir
              </p>
              <p
                className={cn(
                  "mt-0.5 font-mono text-[34px] font-semibold leading-none tabular-nums",
                  contagem.minutos < ULTIMOS && "animate-pulse",
                )}
                style={{ color: cor.texto }}
                aria-live="off"
                aria-label={`Faltam ${contagem.minutos} minutos e ${contagem.segundos} segundos`}
              >
                {relogio(contagem)}
              </p>
            </div>
            <p className="max-w-[210px] text-right text-caption text-white/85">
              {recadoDoRelogio(contagem)}
            </p>
          </div>

          {/* A barra drena sobre a janela real da clínica: quem abre o link
              atrasado já encontra ela pela metade, que é a verdade. */}
          <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-white/20">
            <div
              className="h-full rounded-pill transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.max(2, contagem.fracao * 100)}%`, backgroundColor: cor.barra }}
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}

/** O valor, que é a segunda pergunta de quem abre a tela. */
function Valor({
  valorCents,
  precoCents,
  restanteCents,
}: {
  valorCents: number;
  precoCents: number;
  restanteCents: number;
}) {
  return (
    <div className="rounded-card bg-accent-soft px-4 py-4">
      <p className="text-caption text-accent">
        {restanteCents > 0 ? "Para garantir o horário" : "Valor do atendimento"}
      </p>
      <p className="mt-0.5 text-display text-ink">{formatBRL(valorCents)}</p>
      {restanteCents > 0 ? (
        <p className="mt-2 flex items-center justify-between gap-4 border-t border-accent/15 pt-2 text-caption text-ink-secondary">
          <span>Restante no dia do atendimento</span>
          <span className="tabular-nums text-ink">{formatBRL(restanteCents)}</span>
        </p>
      ) : null}
      {restanteCents > 0 ? (
        <p className="mt-1 flex items-center justify-between gap-4 text-caption text-ink-tertiary">
          <span>Total do serviço</span>
          <span className="tabular-nums">{formatBRL(precoCents)}</span>
        </p>
      ) : null}
    </div>
  );
}

function Resumo({ reserva, esmaecido = false }: { reserva: CheckoutDaReserva; esmaecido?: boolean }) {
  const quando = reserva.quando.charAt(0).toUpperCase() + reserva.quando.slice(1);
  return (
    <dl
      className={cn(
        "divide-y divide-line overflow-hidden rounded-card border border-line",
        esmaecido && "opacity-60",
      )}
    >
      <Linha icone={<Sparkles className="size-4" aria-hidden />} rotulo="Serviço" valor={reserva.servico} />
      <Linha icone={<CalendarDays className="size-4" aria-hidden />} rotulo="Quando" valor={quando} />
      <Linha icone={<UserRound className="size-4" aria-hidden />} rotulo="Com" valor={reserva.profissional} />
      <Linha icone={<MapPin className="size-4" aria-hidden />} rotulo="Onde" valor={reserva.unidade} />
    </dl>
  );
}

function Linha({
  icone,
  rotulo,
  valor,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-ink-tertiary">
        {icone}
      </span>
      <dt className="shrink-0 text-caption text-ink-secondary">{rotulo}</dt>
      <dd className="ml-auto min-w-0 text-right text-label text-ink">{valor}</dd>
    </div>
  );
}

function Rodape({ clinica }: { clinica: string }) {
  return (
    <p className="mt-7 border-t border-line pt-4 text-center text-caption text-ink-tertiary">
      {clinica} · Agenda de Unha
    </p>
  );
}

/**
 * Quem processa o pagamento, dito no lugar onde a pergunta nasce.
 *
 * Escrito como texto, não como logotipo: usar a marca de terceiro exige o
 * arquivo oficial e as regras de uso dele, e um logotipo aproximado passa a
 * impressão contrária da que se quer aqui. O nome, com o peso certo, faz o
 * trabalho.
 */
function MarcaAsaas() {
  return <strong className="font-semibold">Asaas</strong>;
}

/**
 * A barra de ambiente seguro.
 *
 * Fica ENCOSTADA na escolha do meio de pagamento, não no rodapé: a dúvida
 * ("onde eu estou colocando meu cartão?") aparece no instante em que a pessoa
 * decide pagar, e é ali que a resposta precisa estar. É o mesmo lugar em que
 * as plataformas grandes põem a sua.
 */
function BarraSegura() {
  return (
    <div className="flex items-center gap-2 rounded-card bg-surface-sunken px-3 py-2">
      <Lock className="size-3.5 shrink-0 text-positive" aria-hidden />
      <span className="text-caption text-ink-secondary">
        Ambiente seguro · pagamento processado por <MarcaAsaas />
      </span>
    </div>
  );
}

/**
 * O selo de garantias.
 *
 * Cada linha é uma afirmação verificável, com o ícone do que ela afirma — e
 * não quatro tiques iguais, que viram textura e ninguém lê. Promessa vaga de
 * segurança não tranquiliza quem já desconfia; fato curto, com o símbolo
 * certo ao lado, tranquiliza.
 */
function SeloDeSeguranca({ clinica }: { clinica: string }) {
  return (
    <section
      aria-label="Segurança do pagamento"
      className="mt-6 overflow-hidden rounded-card border border-line"
    >
      <p className="flex items-center gap-2 border-b border-line bg-positive-soft px-4 py-2.5 text-label text-positive">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Pagamento 100% seguro
      </p>
      <ul className="space-y-3 px-4 py-4">
        <Garantia icone={<Landmark className="size-4" aria-hidden />} titulo="Processado pelo Asaas">
          Instituição de pagamento autorizada pelo Banco Central do Brasil.
        </Garantia>
        <Garantia icone={<Lock className="size-4" aria-hidden />} titulo="Conexão criptografada">
          Seus dados seguem protegidos do seu aparelho até o Asaas.
        </Garantia>
        <Garantia
          icone={<CreditCard className="size-4" aria-hidden />}
          titulo="Seu cartão não fica guardado aqui"
        >
          O Agenda de Unha não armazena número nem código de segurança.
        </Garantia>
        <Garantia
          icone={<Store className="size-4" aria-hidden />}
          titulo={`O valor vai direto para ${clinica}`}
        >
          A plataforma não retém o seu dinheiro em nenhum momento.
        </Garantia>
      </ul>
    </section>
  );
}

function Garantia({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-positive-soft text-positive">
        {icone}
      </span>
      <span className="text-caption text-ink-secondary">
        <span className="block text-label text-ink">{titulo}</span>
        {children}
      </span>
    </li>
  );
}

/** PIX ou cartão. PIX na frente porque confirma na hora e pede um campo só. */
function Pagamento({
  token,
  reserva,
  onPago,
  onEsperar,
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onPago: () => void;
  onEsperar: () => void;
}) {
  const [meio, setMeio] = useState<"pix" | "cartao">(reserva.pixDisponivel ? "pix" : "cartao");

  return (
    <div className="mt-5">
      <div className="mb-3">
        <BarraSegura />
      </div>
      {reserva.pixDisponivel ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Como você quer pagar">
          <Meio
            ativo={meio === "pix"}
            onClick={() => setMeio("pix")}
            icone={<Landmark className="size-[18px]" aria-hidden />}
            titulo="PIX"
            nota="Confirma na hora"
          />
          <Meio
            ativo={meio === "cartao"}
            onClick={() => setMeio("cartao")}
            icone={<CreditCard className="size-[18px]" aria-hidden />}
            titulo="Cartão"
            nota="Crédito à vista"
          />
        </div>
      ) : null}

      <div className="mt-4">
        {meio === "pix" ? (
          <FormaPix token={token} reserva={reserva} onEsperar={onEsperar} />
        ) : (
          <FormaCartao token={token} reserva={reserva} onPago={onPago} onEsperar={onEsperar} />
        )}
      </div>
    </div>
  );
}

function Meio({
  ativo,
  onClick,
  icone,
  titulo,
  nota,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  titulo: string;
  nota: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "relative rounded-card border-2 px-4 py-3.5 text-left transition-colors",
        ativo
          ? "border-accent bg-accent-soft"
          : "border-line hover:border-ink-tertiary hover:bg-surface-sunken",
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-pill",
          ativo ? "bg-accent text-white" : "bg-surface-sunken text-ink-secondary",
        )}
      >
        {icone}
      </span>
      <span className={cn("mt-2 block text-label", ativo ? "text-accent" : "text-ink")}>
        {titulo}
      </span>
      <span className="block text-caption text-ink-secondary">{nota}</span>
      {/* A marca de seleção fecha a leitura: a borda sozinha some no celular. */}
      {ativo ? (
        <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-pill bg-accent text-white">
          <Check className="size-3" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

/**
 * PIX.
 *
 * Pede CPF porque o Asaas exige documento para cobrar, e não porque nós
 * queremos: a frase no campo diz isso, senão o pedido parece invasivo no pior
 * momento possível. Depois de gerado, o mesmo QR volta em toda visita — dois
 * QR válidos para o mesmo horário viraria dinheiro a devolver.
 */
function FormaPix({
  token,
  reserva,
  onEsperar,
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onEsperar: () => void;
}) {
  const [cpf, setCpf] = useState(reserva.cliente.cpf ? formatarCpf(reserva.cliente.cpf) : "");
  const [pix, setPix] = useState<PixParaPagar | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [gerando, startGerando] = useTransition();

  function gerar() {
    setErro(null);
    if (!cpfValido(cpf)) {
      setErro("Confira o CPF: os números não fecham.");
      return;
    }
    startGerando(async () => {
      const resultado = await gerarPixAction({ token, cpf });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setPix(resultado.pix);
      // Daqui em diante existe dinheiro a esperar: quem pergunta é o pai.
      onEsperar();
    });
  }

  async function copiar() {
    if (!pix) return;
    if (!(await copyToClipboard(pix.copiaECola))) {
      setErro("Não consegui copiar. Selecione o código e copie manualmente.");
      return;
    }
    setCopiado(true);
  }

  if (pix) {
    return (
      <div className="rounded-card border border-line px-4 py-4">
        <div className="mx-auto flex size-[228px] items-center justify-center rounded-card border border-line bg-white p-3 shadow-[0_8px_24px_rgb(67_35_88/0.08)]">
          <img
            src={`data:image/png;base64,${pix.imagemBase64}`}
            alt="QR code do PIX"
            className="size-full object-contain"
          />
        </div>
        <p className="mt-5 text-center text-label text-ink">Abra o app do banco e leia o QR</p>
        <p className="mt-1 text-center text-caption text-ink-secondary">
          Ou use o código abaixo, na opção PIX copia e cola.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-card bg-surface-sunken px-3 py-2 text-caption text-ink">
            {pix.copiaECola}
          </code>
          <Button variant="secondary" onClick={copiar} aria-label="Copiar código do PIX">
            {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <p className="mt-4 flex items-center gap-2 text-caption text-ink-secondary" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Esperando o pagamento. Esta tela confirma sozinha, não precisa recarregar.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-caption text-ink-tertiary">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Cobrança PIX emitida pelo <MarcaAsaas />
        </p>
        {erro ? <p className="mt-2 text-caption text-danger">{erro}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line px-4 py-4">
      <Field
        label="CPF"
        htmlFor="pix-cpf"
        hint="O Asaas exige o CPF de quem paga para emitir a cobrança."
        error={erro ?? undefined}
      >
        <Input
          id="pix-cpf"
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(evento) => setCpf(formatarCpf(evento.target.value))}
        />
      </Field>
      <Button variant="primary" size="lg" className="mt-4 w-full" loading={gerando} onClick={gerar}>
        Gerar código PIX
      </Button>
    </div>
  );
}

/**
 * Cartão de crédito.
 *
 * CEP e número do endereço estão aqui porque o antifraude do Asaas os exige
 * para cartão; não é cadastro nosso. Cada campo que dá para conferir antes é
 * conferido antes: recusa do adquirente é resposta ruim de receber.
 */
function FormaCartao({
  token,
  reserva,
  onPago,
  onEsperar,
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onPago: () => void;
  onEsperar: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [nomeImpresso, setNomeImpresso] = useState(reserva.cliente.nome);
  const [validade, setValidade] = useState("");
  const [cvv, setCvv] = useState("");
  const [cpf, setCpf] = useState(reserva.cliente.cpf ? formatarCpf(reserva.cliente.cpf) : "");
  const [email, setEmail] = useState(reserva.cliente.email ?? "");
  const [cep, setCep] = useState("");
  const [numeroDoEndereco, setNumeroDoEndereco] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [emAnalise, setEmAnalise] = useState(false);
  const [pagando, startPagando] = useTransition();

  // Mostrar a bandeira reconhecida é devolução, não validação: quem digita vê
  // que o número está indo para o lugar certo.
  const bandeira = bandeiraDoCartao(numero);

  function pagar() {
    setErro(null);
    if (!numeroDeCartaoPlausivel(numero)) return setErro("Confira o número do cartão.");
    if (!lerValidade(validade)) return setErro("Confira a validade do cartão.");
    if (cvv.replace(/\D/g, "").length < 3) return setErro("Confira o código de segurança.");
    if (!cpfValido(cpf)) return setErro("Confira o CPF: os números não fecham.");
    if (!email.includes("@")) return setErro("Informe um e-mail para o recibo.");
    if (cep.replace(/\D/g, "").length !== 8) return setErro("Confira o CEP.");
    if (!numeroDoEndereco.trim()) return setErro("Informe o número do endereço.");

    startPagando(async () => {
      const resultado = await pagarComCartaoAction({
        token,
        numero,
        nomeImpresso,
        validade,
        cvv,
        cpf,
        email,
        cep,
        numeroDoEndereco,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      if (resultado.pago) {
        onPago();
        return;
      }
      // Cartão em análise é raro e existe: a tela espera, como no PIX.
      setEmAnalise(true);
      onEsperar();
    });
  }

  if (emAnalise) {
    return (
      <div className="rounded-card border border-line px-4 py-4">
        <p className="flex items-center gap-2 text-label text-ink" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Conferindo com o banco
        </p>
        <p className="mt-1 text-caption text-ink-secondary">
          O <MarcaAsaas /> está conferindo com o banco emissor. Costuma levar poucos segundos, e
          esta tela confirma sozinha. Não feche.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-card border border-line px-4 py-4">
      {/* O aviso fica ACIMA do primeiro campo do cartão: é onde a mão para. */}
      <p className="flex items-start gap-2 rounded-card bg-surface-sunken px-3 py-2.5 text-caption text-ink-secondary">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-positive" aria-hidden />
        <span>
          Seus dados vão criptografados direto para o <MarcaAsaas />. O Agenda de Unha não guarda o
          número do seu cartão nem o código de segurança.
        </span>
      </p>

      <Field label="Número do cartão" htmlFor="cartao-numero">
        <div className="relative">
          <Input
            id="cartao-numero"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            className={bandeira ? "pr-[124px]" : undefined}
            value={numero}
            onChange={(evento) => setNumero(formatarNumeroDoCartao(evento.target.value))}
          />
          {bandeira ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-pill bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
              {bandeira}
            </span>
          ) : null}
        </div>
      </Field>
      <Field label="Nome impresso no cartão" htmlFor="cartao-nome">
        <Input
          id="cartao-nome"
          autoComplete="cc-name"
          value={nomeImpresso}
          onChange={(evento) => setNomeImpresso(evento.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Validade" htmlFor="cartao-validade">
          <Input
            id="cartao-validade"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            value={validade}
            onChange={(evento) => setValidade(formatarValidade(evento.target.value))}
          />
        </Field>
        <Field label="Código de segurança" htmlFor="cartao-cvv">
          <Input
            id="cartao-cvv"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="000"
            value={cvv}
            onChange={(evento) => setCvv(evento.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </Field>
      </div>
      <Field label="CPF do titular" htmlFor="cartao-cpf">
        <Input
          id="cartao-cpf"
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={(evento) => setCpf(formatarCpf(evento.target.value))}
        />
      </Field>
      <Field label="E-mail" htmlFor="cartao-email" hint="Para você receber o recibo do pagamento.">
        <Input
          id="cartao-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
      </Field>
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Field label="CEP" htmlFor="cartao-cep">
          <Input
            id="cartao-cep"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={cep}
            onChange={(evento) => setCep(formatarCep(evento.target.value))}
          />
        </Field>
        <Field label="Número" htmlFor="cartao-numero-endereco">
          <Input
            id="cartao-numero-endereco"
            inputMode="numeric"
            value={numeroDoEndereco}
            onChange={(evento) => setNumeroDoEndereco(evento.target.value.slice(0, 10))}
          />
        </Field>
      </div>

      {erro ? (
        <p role="alert" className="flex items-start gap-2 rounded-card bg-danger-soft px-3 py-2.5 text-caption text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </p>
      ) : null}

      <Button variant="primary" size="lg" className="w-full" loading={pagando} onClick={pagar}>
        <Lock className="size-4" aria-hidden />
        Pagar {formatBRL(reserva.valorCents)}
      </Button>
    </div>
  );
}
