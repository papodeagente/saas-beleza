"use client";

import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Copy,
  CreditCard,
  Info,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { valorDaReserva } from "@/domain/booking-payment";
import { copyToClipboard } from "@/lib/clipboard";
import { useFuso } from "@/lib/fuso";
import { formatBRL } from "@/lib/money";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  type ContaSerializada,
  conectarAsaasAction,
  desconectarAsaasAction,
  reconferirPixAction,
  salvarRegraAction,
} from "./actions";

type Regra = { exigirPagamento: boolean; percentual: number; minutosDeReserva: number };

/** Onde a chave mora no painel do Asaas. Poupa a busca — e o chamado. */
const ASAAS_CHAVE_URL = "https://www.asaas.com/customerApiAccessToken/index";

const PERCENTUAIS = [30, 50, 100];
const PRAZOS = [15, 30, 60];

function rotuloDoPrazo(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = minutos / 60;
  return horas === 1 ? "1 hora" : `${Number.isInteger(horas) ? horas : horas.toFixed(1)} horas`;
}

/**
 * Pagamentos da clínica.
 *
 * Duas decisões de tela que vêm do que dá errado na prática:
 *
 * 1. **A exigência de pagamento fica DESLIGADA e indisponível até a conta
 *    estar conectada.** Ligar antes trancaria o agendamento online: a cliente
 *    escolheria o horário e não teria como pagar.
 * 2. **O exemplo usa um preço real do catálogo.** "Sinal de 50%" é abstrato;
 *    "a cliente paga R$ 60 agora e R$ 60 no dia" é a decisão que a dona está
 *    tomando de verdade.
 */
export function PagamentosView({
  conta: contaInicial,
  regra: regraInicial,
  exemploPrecoCents,
}: {
  conta: ContaSerializada | null;
  regra: Regra;
  /** Preço médio dos serviços ativos, para o exemplo da tela. */
  exemploPrecoCents: number;
}) {
  const fuso = useFuso();
  const [conta, setConta] = useState(contaInicial);
  const [regra, setRegra] = useState(regraInicial);
  const [salva, setSalva] = useState(regraInicial);
  const [chave, setChave] = useState("");
  const [conectando, startConectando] = useTransition();
  const [salvando, startSalvando] = useTransition();
  const [desconectando, startDesconectando] = useTransition();
  const [conferindo, startConferindo] = useTransition();

  const mudou =
    regra.exigirPagamento !== salva.exigirPagamento ||
    regra.percentual !== salva.percentual ||
    regra.minutosDeReserva !== salva.minutosDeReserva;

  // A MESMA função que gera a cobrança, não uma cópia da fórmula: tela que
  // promete um valor e Asaas que cobra outro é o defeito mais caro daqui.
  const sinalCents = valorDaReserva(exemploPrecoCents, regra.percentual);
  const restanteCents = Math.max(0, exemploPrecoCents - sinalCents);

  function conectar() {
    startConectando(async () => {
      const result = await conectarAsaasAction({ chave });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConta(result.conta);
      setChave("");
      toast.success("Conta do Asaas conectada.");
    });
  }

  function desconectar() {
    startDesconectando(async () => {
      const result = await desconectarAsaasAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConta(null);
      // O serviço desliga a exigência na mesma transação; a tela acompanha,
      // senão o interruptor ficaria ligado mostrando um estado que não existe.
      const semCobranca = { ...regra, exigirPagamento: false };
      setRegra(semCobranca);
      setSalva(semCobranca);
      toast.success("Conta desconectada. O agendamento online voltou a ser sem pagamento.");
    });
  }

  function conferirPix() {
    startConferindo(async () => {
      const result = await reconferirPixAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConta(result.conta);
      toast[result.conta?.pixPronto ? "success" : "error"](
        result.conta?.pixPronto
          ? "PIX liberado. O checkout já oferece PIX para suas clientes."
          : "Ainda não encontrei chave PIX ativa nesta conta do Asaas.",
      );
    });
  }

  function salvar() {
    startSalvando(async () => {
      const result = await salvarRegraAction(regra);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSalva(regra);
      toast.success(
        regra.exigirPagamento
          ? "Pronto. O agendamento online agora pede pagamento."
          : "Pronto. O agendamento online não pede pagamento.",
      );
    });
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-title text-ink">Pagamentos</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Receba pela sua própria conta do Asaas, com a cliente pagando por PIX ou cartão sem sair
          da sua página de agendamento. O dinheiro cai direto na sua conta, sem passar pela
          plataforma e sem repasse.
        </p>
      </header>

      {conta ? (
        <Card className="mb-4">
          <CardHeader
            title="Sua conta do Asaas"
            action={
              <Badge tone={conta.status === "conectada" ? "positive" : "danger"}>
                {conta.status === "conectada" ? "Conectada" : "Com erro"}
              </Badge>
            }
          />
          <div className="border-t border-line px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-positive-soft text-positive">
                <BadgeCheck className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-label text-ink">
                  {conta.nomeDaConta ?? "Conta do Asaas"}
                </p>
                <p className="truncate text-caption text-ink-secondary">
                  {conta.emailDaConta ?? "sem e-mail no cadastro"} · chave {conta.chaveMascarada}
                </p>
              </div>
            </div>

            {conta.ambiente === "sandbox" ? (
              <p className="mt-4 flex items-start gap-2 rounded-card bg-attention-soft px-3 py-2.5 text-caption text-attention">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Esta é uma chave de <strong>teste</strong> (sandbox). Serve para experimentar:
                  nenhum pagamento é real. Para receber de verdade, cole a chave de produção.
                </span>
              </p>
            ) : null}

            {/* PIX indisponível não quebra o recurso, mas muda o que a cliente
                vê: sem chave PIX na conta do Asaas, o checkout só oferece
                cartão — e cartão sozinho derruba pagamento de quem não tem um
                à mão. O aviso fica aqui porque é aqui que ela resolve. */}
            {conta.pixPronto ? null : (
              <p className="mt-4 flex items-start gap-2 rounded-card bg-attention-soft px-3 py-2.5 text-caption text-attention">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Sua conta do Asaas ainda não tem <strong>chave PIX</strong>. Enquanto isso, o
                  pagamento só acontece por cartão. Cadastre a chave no Asaas e confira aqui.
                  <Button
                    variant="link"
                    className="ml-1 align-baseline"
                    loading={conferindo}
                    onClick={conferirPix}
                  >
                    Conferir de novo
                  </Button>
                </span>
              </p>
            )}

            {conta.webhookAutomatico ? (
              <p className="mt-4 flex items-start gap-2 text-caption text-ink-secondary">
                <Check className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
                O aviso de pagamento já está configurado na sua conta. Quando a cliente paga, o
                agendamento confirma sozinho.
              </p>
            ) : (
              <AvisoManual url={conta.webhookUrl} detalhe={conta.statusDetail} />
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="secondary" asChild>
                <a href={ASAAS_CHAVE_URL} target="_blank" rel="noopener noreferrer">
                  Abrir o Asaas
                  <ArrowUpRight className="size-4" aria-hidden />
                </a>
              </Button>
              <Button
                variant="ghost"
                loading={desconectando}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Desconectar a conta do Asaas? A exigência de pagamento será desligada, e o agendamento online volta a confirmar sem cobrança.",
                    )
                  ) {
                    return;
                  }
                  desconectar();
                }}
              >
                <Unplug className="size-4" aria-hidden />
                Desconectar
              </Button>
              {conta.conferidaEm ? (
                <span className="ml-auto text-caption text-ink-tertiary">
                  conferida em {formatTz(new Date(conta.conferidaEm), fuso, "dd/MM 'às' HH:mm")}
                </span>
              ) : null}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader title="Conectar sua conta do Asaas" />
          <div className="border-t border-line px-4 py-4">
            <ol className="mb-5 space-y-3">
              <Passo numero={1}>
                Entre no Asaas e vá em <strong>Integrações</strong> →{" "}
                <strong>Chave de API</strong>.
              </Passo>
              <Passo numero={2}>
                Gere a chave e copie. Ela começa com <code className="text-ink">$aact_</code>.
              </Passo>
              <Passo numero={3}>Cole aqui embaixo. O resto é automático.</Passo>
            </ol>

            <Field
              label="Chave de API do Asaas"
              htmlFor="asaas-chave"
              hint="Guardamos a chave apenas para gerar suas cobranças. Ela nunca aparece inteira nesta tela de novo."
            >
              <Input
                id="asaas-chave"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="$aact_..."
                value={chave}
                onChange={(event) => setChave(event.target.value)}
              />
            </Field>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                loading={conectando}
                disabled={chave.trim().length < 10}
                onClick={conectar}
              >
                <CreditCard className="size-4" aria-hidden />
                Conectar
              </Button>
              <Button variant="ghost" asChild>
                <a href={ASAAS_CHAVE_URL} target="_blank" rel="noopener noreferrer">
                  Onde acho minha chave?
                  <ArrowUpRight className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Exigir pagamento para agendar"
          action={
            <Interruptor
              ligado={regra.exigirPagamento}
              disponivel={Boolean(conta)}
              onChange={(valor) => setRegra({ ...regra, exigirPagamento: valor })}
            />
          }
        />
        <div className="border-t border-line px-4 py-4">
          <p className="text-body text-ink-secondary">
            Vale para o agendamento <strong>online</strong>: a página de agendamento e o
            atendimento pelo WhatsApp. A cliente paga com PIX ou cartão na própria tela, e o
            horário confirma sozinho quando o pagamento entra. Quem marca no balcão continua sem
            cobrança.
          </p>

          {!conta ? (
            <p className="mt-4 flex items-start gap-2 rounded-card bg-surface-sunken px-3 py-2.5 text-caption text-ink-secondary">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Conecte sua conta do Asaas para poder ligar a exigência. Sem conta conectada, a
              cliente escolheria o horário e não teria como pagar.
            </p>
          ) : null}

          {conta && regra.exigirPagamento ? (
            <div className="mt-5 space-y-5">
              <Escolha
                titulo="Quanto a cliente paga para garantir"
                opcoes={PERCENTUAIS.map((valor) => ({
                  valor,
                  rotulo: valor === 100 ? "Valor cheio" : `${valor}%`,
                }))}
                atual={regra.percentual}
                onChange={(valor) => setRegra({ ...regra, percentual: valor })}
              />
              <Escolha
                titulo="Tempo para pagar antes do horário voltar para a agenda"
                opcoes={PRAZOS.map((valor) => ({ valor, rotulo: rotuloDoPrazo(valor) }))}
                atual={regra.minutosDeReserva}
                onChange={(valor) => setRegra({ ...regra, minutosDeReserva: valor })}
              />

              {/* O exemplo é o resumo da decisão. Sem ele, "50%" e "30 min" são
                  dois números soltos; com ele, a dona lê o que a cliente vive. */}
              <div className="rounded-card border border-line bg-surface-sunken px-4 py-3.5">
                <p className="text-eyebrow text-ink-tertiary">Como fica na prática</p>
                <p className="mt-2 text-body text-ink">
                  Num serviço de <strong>{formatBRL(exemploPrecoCents)}</strong>, a cliente paga{" "}
                  <strong>{formatBRL(sinalCents)}</strong> para fechar
                  {restanteCents > 0 ? (
                    <>
                      {" "}
                      e os outros <strong>{formatBRL(restanteCents)}</strong> no dia do atendimento
                    </>
                  ) : null}
                  . O horário fica guardado por {rotuloDoPrazo(regra.minutosDeReserva)}; se o
                  pagamento não entrar, ele volta para a agenda sozinho.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" loading={salvando} disabled={!mudou} onClick={salvar}>
              Salvar
            </Button>
            {mudou ? (
              <span className="text-caption text-ink-secondary">Há alterações não salvas.</span>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Passo({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-semibold text-accent">
        {numero}
      </span>
      <span className="text-body text-ink-secondary">{children}</span>
    </li>
  );
}

/**
 * Interruptor.
 *
 * `aria-disabled` em vez de `disabled`: o botão continua focável para que o
 * leitor de tela anuncie POR QUE está indisponível. Botão desabilitado de
 * verdade some da navegação por teclado e leva a explicação com ele.
 */
function Interruptor({
  ligado,
  disponivel,
  onChange,
}: {
  ligado: boolean;
  disponivel: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-disabled={!disponivel}
      aria-label="Exigir pagamento para agendar"
      onClick={() => {
        if (!disponivel) return;
        onChange(!ligado);
      }}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-pill transition-colors",
        ligado ? "bg-accent" : "bg-surface-sunken ring-1 ring-line",
        disponivel ? "cursor-pointer" : "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-5 rounded-pill bg-white shadow-sm transition-[left]",
          ligado ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

function Escolha({
  titulo,
  opcoes,
  atual,
  onChange,
}: {
  titulo: string;
  opcoes: { valor: number; rotulo: string }[];
  atual: number;
  onChange: (valor: number) => void;
}) {
  return (
    <div>
      <p className="text-label text-ink">{titulo}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={titulo}>
        {opcoes.map((opcao) => (
          <button
            key={opcao.valor}
            type="button"
            aria-pressed={atual === opcao.valor}
            onClick={() => onChange(opcao.valor)}
            className={cn(
              "min-h-11 rounded-pill px-4 text-label transition-colors md:min-h-9",
              atual === opcao.valor
                ? "bg-accent text-white"
                : "bg-surface-sunken text-ink-secondary hover:text-ink",
            )}
          >
            {opcao.rotulo}
          </button>
        ))}
        {opcoes.every((opcao) => opcao.valor !== atual) ? (
          <span className="flex min-h-11 items-center rounded-pill bg-accent px-4 text-label text-white md:min-h-9">
            {atual}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A saída quando o Asaas não deixou registrar o aviso sozinho.
 *
 * Sem este bloco, a conta ficaria "conectada" recebendo pagamento que nunca
 * confirma agendamento — a pior falha possível aqui, porque o dinheiro entra e
 * a cliente fica sem horário.
 */
function AvisoManual({ url, detalhe }: { url: string; detalhe: string | null }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    const ok = await copyToClipboard(url);
    if (!ok) {
      toast.error("Não foi possível copiar. Selecione o endereço e copie manualmente.");
      return;
    }
    setCopiado(true);
    toast.success("Endereço copiado");
  }

  return (
    <div className="mt-4 rounded-card bg-attention-soft px-3 py-3">
      <p className="flex items-start gap-2 text-caption text-attention">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {detalhe ??
            "Falta um passo: o aviso de pagamento não pôde ser criado automaticamente nesta conta."}{" "}
          No Asaas, vá em <strong>Integrações → Webhooks</strong>, crie um webhook com o endereço
          abaixo e marque os eventos de pagamento recebido e confirmado.
        </span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-card bg-surface-raised px-3 py-2 text-caption text-ink">
          {url}
        </code>
        <Button variant="secondary" onClick={copiar} aria-label={`Copiar endereço: ${url}`}>
          {copiado ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
