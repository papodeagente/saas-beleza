"use client";

import {
  Check,
  Clock,
  Copy,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
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
 * Duas decisões que valem a leitura:
 *
 * 1. **A tela pergunta ao servidor se o pagamento caiu, a cada cinco
 *    segundos.** Esperar só pelo webhook do Asaas deixaria a cliente olhando
 *    um QR parado com o dinheiro já na conta da clínica.
 * 2. **O cartão só é enviado depois de Luhn, CPF e validade conferidos aqui.**
 *    Recusa do adquirente é frase feia e assusta; o que dá para pegar antes,
 *    pega-se antes.
 */

const PULSO = 5000;

function useContagem(venceEm: string | null): { minutos: number; segundos: number; acabou: boolean } {
  const limite = useMemo(() => (venceEm ? new Date(venceEm).getTime() : null), [venceEm]);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (limite === null) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [limite]);

  if (limite === null) return { minutos: 0, segundos: 0, acabou: false };
  const restante = Math.max(0, limite - agora);
  return {
    minutos: Math.floor(restante / 60_000),
    segundos: Math.floor((restante % 60_000) / 1000),
    acabou: restante <= 0,
  };
}

export function CheckoutView({ token, reserva }: { token: string; reserva: CheckoutDaReserva }) {
  const [estado, setEstado] = useState(reserva.estado);
  const { minutos, segundos, acabou } = useContagem(estado === "aguardando" ? reserva.venceEm : null);

  const restanteCents = Math.max(0, reserva.precoCents - reserva.valorCents);
  const vencido = estado === "vencido" || (estado === "aguardando" && acabou);

  if (estado === "pago") {
    return (
      <Moldura
        clinica={reserva.clinica}
        icone={<Check className="size-6" aria-hidden />}
        eyebrow="Pagamento confirmado"
        titulo="Seu horário está confirmado"
        subtitulo={`${reserva.clinica} já recebeu o pagamento. Até logo!`}
      >
        <Resumo reserva={reserva} />
        <p className="mt-5 text-caption text-ink-secondary">
          Não precisa mandar comprovante. Para remarcar ou cancelar, fale com a recepção.
        </p>
      </Moldura>
    );
  }

  if (vencido) {
    return (
      <Moldura
        clinica={reserva.clinica}
        icone={<Clock className="size-6" aria-hidden />}
        eyebrow="Tempo esgotado"
        titulo="Este horário voltou para a agenda"
        subtitulo="O prazo do pagamento passou. É só escolher um horário de novo."
      >
        <Button variant="primary" size="lg" className="w-full" asChild>
          <a href={`/agendar/${reserva.slug}`}>Escolher outro horário</a>
        </Button>
        <div className="mt-5">
          <Resumo reserva={reserva} esmaecido />
        </div>
      </Moldura>
    );
  }

  if (estado === "estornado") {
    return (
      <Moldura
        clinica={reserva.clinica}
        icone={<TriangleAlert className="size-6" aria-hidden />}
        eyebrow="Pagamento estornado"
        titulo="O valor foi devolvido"
        subtitulo={`Fale com ${reserva.clinica} para saber se o atendimento continua de pé.`}
      >
        <Resumo reserva={reserva} esmaecido />
      </Moldura>
    );
  }

  if (estado === "sem_cobranca") {
    return (
      <Moldura
        clinica={reserva.clinica}
        icone={<Check className="size-6" aria-hidden />}
        eyebrow="Tudo certo"
        titulo="Este horário não precisa de pagamento"
        subtitulo={`${reserva.clinica} espera por você.`}
      >
        <Resumo reserva={reserva} />
      </Moldura>
    );
  }

  return (
    <Moldura
      clinica={reserva.clinica}
      icone={<Lock className="size-6" aria-hidden />}
      eyebrow="Falta o pagamento"
      titulo="Seu horário está guardado"
      subtitulo={`${reserva.clinica} guarda este horário até o pagamento entrar.`}
      contagem={`${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`}
    >
      <div className="rounded-card border border-line px-4 py-4">
        <p className="text-caption text-ink-secondary">
          {restanteCents > 0 ? "Para garantir o horário" : "Valor do atendimento"}
        </p>
        <p className="text-display text-ink">{formatBRL(reserva.valorCents)}</p>
        {restanteCents > 0 ? (
          <p className="mt-1 text-caption text-ink-secondary">
            Os outros {formatBRL(restanteCents)} são pagos no dia do atendimento.
          </p>
        ) : null}
      </div>

      <Pagamento
        token={token}
        reserva={reserva}
        onPago={() => setEstado("pago")}
      />

      <div className="mt-5">
        <Resumo reserva={reserva} />
      </div>

      <p className="mt-5 flex items-start gap-2 text-caption text-ink-secondary">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Pagamento processado pelo Asaas, direto para {reserva.clinica}. Os dados do seu cartão não
        ficam guardados aqui.
      </p>
    </Moldura>
  );
}

/** A casca roxa, igual à do agendamento: é a mesma marca, o mesmo momento. */
function Moldura({
  clinica,
  icone,
  eyebrow,
  titulo,
  subtitulo,
  contagem,
  children,
}: {
  clinica: string;
  icone: React.ReactNode;
  eyebrow: string;
  titulo: string;
  subtitulo: string;
  contagem?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#f1e5fb_0,transparent_36%),var(--color-surface)] px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-[560px] overflow-hidden rounded-overlay bg-surface-raised shadow-[0_28px_80px_rgb(67_35_88/0.16)]">
        <div className="bg-brand px-7 py-8 text-white sm:px-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex size-12 items-center justify-center rounded-pill bg-white/16 ring-1 ring-white/25">
              {icone}
            </div>
            {contagem ? (
              <span
                className="rounded-pill bg-white/16 px-3 py-1.5 font-mono text-label tabular-nums text-white ring-1 ring-white/25"
                aria-label="tempo restante para pagar"
              >
                {contagem}
              </span>
            ) : null}
          </div>
          <p className="mt-6 text-eyebrow text-white">{eyebrow}</p>
          <h1 className="mt-2 text-display text-white">{titulo}</h1>
          <p className="mt-2 text-body text-white">{subtitulo}</p>
        </div>
        <div className="px-7 py-7 sm:px-10">
          {children}
          <p className="mt-7 border-t border-line pt-4 text-center text-caption text-ink-tertiary">
            {clinica} · Agenda de Unha
          </p>
        </div>
      </div>
    </main>
  );
}

function Resumo({ reserva, esmaecido = false }: { reserva: CheckoutDaReserva; esmaecido?: boolean }) {
  const quando = reserva.quando.charAt(0).toUpperCase() + reserva.quando.slice(1);
  return (
    <dl className={cn("divide-y divide-line rounded-card border border-line", esmaecido && "opacity-60")}>
      <Linha rotulo="Serviço" valor={reserva.servico} />
      <Linha rotulo="Quando" valor={quando} />
      <Linha rotulo="Com" valor={reserva.profissional} />
      <Linha rotulo="Onde" valor={reserva.unidade} />
    </dl>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-caption text-ink-secondary">{rotulo}</dt>
      <dd className="min-w-0 text-right text-label text-ink">{valor}</dd>
    </div>
  );
}

/** PIX ou cartão. PIX na frente porque confirma na hora e pede um campo só. */
function Pagamento({
  token,
  reserva,
  onPago,
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onPago: () => void;
}) {
  const [meio, setMeio] = useState<"pix" | "cartao">(reserva.pixDisponivel ? "pix" : "cartao");

  return (
    <div className="mt-5">
      {reserva.pixDisponivel ? (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Como você quer pagar">
          <Meio
            ativo={meio === "pix"}
            onClick={() => setMeio("pix")}
            icone={<Landmark className="size-4" aria-hidden />}
            titulo="PIX"
            nota="Confirma na hora"
          />
          <Meio
            ativo={meio === "cartao"}
            onClick={() => setMeio("cartao")}
            icone={<CreditCard className="size-4" aria-hidden />}
            titulo="Cartão"
            nota="Crédito"
          />
        </div>
      ) : null}

      <div className="mt-4">
        {meio === "pix" ? (
          <FormaPix token={token} reserva={reserva} onPago={onPago} />
        ) : (
          <FormaCartao token={token} reserva={reserva} onPago={onPago} />
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
        "rounded-card border px-4 py-3 text-left transition-colors",
        ativo ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-sunken",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-label", ativo ? "text-accent" : "text-ink")}>
        {icone}
        {titulo}
      </span>
      <span className="mt-0.5 block text-caption text-ink-secondary">{nota}</span>
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
  onPago,
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onPago: () => void;
}) {
  const [cpf, setCpf] = useState(reserva.cliente.cpf ? formatarCpf(reserva.cliente.cpf) : "");
  const [pix, setPix] = useState<PixParaPagar | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [gerando, startGerando] = useTransition();

  // Enquanto o QR está na tela, pergunta ao servidor se o dinheiro entrou.
  useEffect(() => {
    if (!pix) return;
    const id = setInterval(async () => {
      const { pago } = await conferirPagamentoAction(token);
      if (pago) onPago();
    }, PULSO);
    return () => clearInterval(id);
  }, [pix, token, onPago]);

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
        <div className="mx-auto flex size-[216px] items-center justify-center rounded-control border border-line bg-white p-2">
          <img
            src={`data:image/png;base64,${pix.imagemBase64}`}
            alt="QR code do PIX"
            className="size-full object-contain"
          />
        </div>
        <p className="mt-4 text-label text-ink">Abra o app do banco e leia o QR</p>
        <p className="mt-1 text-caption text-ink-secondary">
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
}: {
  token: string;
  reserva: CheckoutDaReserva;
  onPago: () => void;
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

  // Cartão em análise é raro e existe: a tela espera como no PIX.
  useEffect(() => {
    if (!emAnalise) return;
    const id = setInterval(async () => {
      const { pago } = await conferirPagamentoAction(token);
      if (pago) onPago();
    }, PULSO);
    return () => clearInterval(id);
  }, [emAnalise, token, onPago]);

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
      setEmAnalise(true);
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
          Isso costuma levar poucos segundos. Não feche esta tela.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-card border border-line px-4 py-4">
      <Field label="Número do cartão" htmlFor="cartao-numero">
        <Input
          id="cartao-numero"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
          value={numero}
          onChange={(evento) => setNumero(formatarNumeroDoCartao(evento.target.value))}
        />
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
        Pagar {formatBRL(reserva.valorCents)}
      </Button>
    </div>
  );
}
