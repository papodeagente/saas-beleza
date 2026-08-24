"use client";

import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus, Check, ChevronRight, Clock, MapPin, Phone, Plus } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand";
import { type Esmalte, esmalteDe } from "./esmaltes";
import { baixarICS, montarICS } from "./ics";
import {
  type BookingConfirmation,
  publicAvailableDaysAction,
  publicBookingAction,
  publicSlotsAction,
  trackBookingAccessAction,
} from "./actions";
import type { PublicSlot } from "@/server/services/public-booking-service";

type Service = {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  categoryName: string | null;
};

type Branch = { id: number; name: string; address: string | null; phone: string | null };

/**
 * "dia" e "hora" eram duas telas. Viraram uma só: no celular a escolha do dia
 * custava 900px de rolagem e mais um toque para depois descobrir que aquele dia
 * não tinha o horário que servia. Agora a faixa de dias fica fixa no topo do
 * passo e os horários trocam embaixo dela.
 */
type Step = "service" | "branch" | "when" | "identify" | "done";

/** Abreviação de 3 letras: o nome por extenso vaza do chip de data. */
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Campo de formulário DESTA página — 16px, e o número é a razão de existir.
 *
 * O `Input` do produto vem em `text-label`, 13px. Abaixo de 16px o Safari do
 * iPhone dá zoom sozinho ao focar o campo: a página inteira reescala, o botão
 * de confirmar sai de vista e a cliente precisa se reorientar no exato passo em
 * que desistir custa menos que continuar. No painel interno o zoom é aceitável
 * — quem opera está sentado e conhece a tela. Aqui não é.
 *
 * `font-normal` desfaz o peso 600 que vem junto do `text-card`: o que se quer
 * dele é só o corpo de 16px, não a ênfase.
 */
const CAMPO = "h-12 text-card font-normal";

export function BookingFlow({
  slug,
  organizationName,
  branches,
  services,
}: {
  slug: string;
  organizationName: string;
  branches: Branch[];
  services: Service[];
}) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [branch, setBranch] = useState<Branch | null>(branches.length === 1 ? branches[0] : null);
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [availableDays, setAvailableDays] = useState<Array<{ dateISO: string; slotCount: number }> | null>(null);
  const [loadingDays, startDaysTransition] = useTransition();
  const [loadingSlots, startSlotsTransition] = useTransition();
  const [slot, setSlot] = useState<PublicSlot | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [mostrarEmail, setMostrarEmail] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const storageKey = `agenda-visitor:${slug}`;
    let visitorToken = window.localStorage.getItem(storageKey);
    if (!visitorToken) {
      visitorToken = crypto.randomUUID();
      window.localStorage.setItem(storageKey, visitorToken);
    }
    void trackBookingAccessAction({ slug, visitorToken });
  }, [slug]);

  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(new Date(), i)), []);

  /**
   * Ao carregar os dias, o primeiro dia livre já é escolhido e seus horários
   * já são buscados. É um toque a menos, e resolve o caso mais comum de todos:
   * a cliente quer o horário mais próximo possível.
   */
  function loadDays(next: { service: Service | null; branch: Branch | null }) {
    setAvailableDays(null);
    setSlot(null);
    setSlots(null);
    if (!next.service) return;
    startDaysTransition(async () => {
      const rows = await publicAvailableDaysAction({
        slug,
        serviceId: next.service!.id,
        branchId: next.branch?.id,
        dateISOs: days.map((date) => format(date, "yyyy-MM-dd")),
      });
      setAvailableDays(rows);
      const primeiro = rows[0];
      if (primeiro) {
        setDay(primeiro.dateISO);
        loadSlots({ ...next, day: primeiro.dateISO });
      }
    });
  }

  /**
   * Carregar horários é sempre consequência de uma escolha do cliente
   * (serviço, unidade ou data), então roda numa transição — o indicador de
   * carregamento vem do React, sem efeito nem render em cascata.
   */
  function loadSlots(next: { service: Service | null; branch: Branch | null; day: string }) {
    setSlot(null);
    if (!next.service) {
      setSlots(null);
      return;
    }
    startSlotsTransition(async () => {
      const rows = await publicSlotsAction({
        slug,
        serviceId: next.service!.id,
        dateISO: next.day,
        branchId: next.branch?.id,
      });
      setSlots(rows);
    });
  }

  function chooseService(value: Service) {
    setService(value);
    if (branches.length > 1) {
      setStep("branch");
      return;
    }
    setStep("when");
    loadDays({ service: value, branch });
  }

  function chooseBranch(value: Branch) {
    setBranch(value);
    setStep("when");
    loadDays({ service, branch: value });
  }

  function chooseDay(value: string) {
    setDay(value);
    loadSlots({ service, branch, day: value });
  }

  function submit() {
    if (!service || !slot) return;
    setError(null);
    startTransition(async () => {
      const result = await publicBookingAction({
        slug,
        serviceId: service.id,
        startsAt: slot.startsAt,
        professionalId: slot.professionalId,
        branchId: slot.branchId,
        resourceId: slot.resourceId,
        name,
        phone,
        email,
        consentMarketing,
      });
      if (result.ok) {
        setConfirmation(result.confirmation);
        setStep("done");
      } else {
        setError(result.error);
        // O horário pode ter sido ocupado enquanto o cliente preenchia os dados
        const fresh = await publicSlotsAction({
          slug,
          serviceId: service.id,
          dateISO: day,
          branchId: branch?.id,
        });
        setSlots(fresh);
        if (!fresh.some((s) => s.startsAt === slot.startsAt)) {
          setSlot(null);
          setStep("when");
        }
      }
    });
  }

  // Horários únicos por etiqueta (o cliente escolhe hora, não profissional)
  const times = thinOut(
    slots ? [...new Map(slots.map((s) => [s.label, s])).entries()].map(([, value]) => value) : [],
  );
  const manha = times.filter((s) => Number(s.label.slice(0, 2)) < 12);
  const tarde = times.filter((s) => {
    const h = Number(s.label.slice(0, 2));
    return h >= 12 && h < 18;
  });
  const noite = times.filter((s) => Number(s.label.slice(0, 2)) >= 18);
  const dayDate = days.find((d) => format(d, "yyyy-MM-dd") === day) ?? days[0];
  const esmalte = esmalteDe(service?.categoryName);
  const unidade = branch ?? (branches.length === 1 ? branches[0] : null);

  if (step === "done" && confirmation && service && slot) {
    return (
      <Vitrine organizationName={organizationName} unidade={unidade}>
        <Bilhete
          confirmation={confirmation}
          esmalte={esmalte}
          organizationName={organizationName}
          service={service}
          slot={slot}
        />
      </Vitrine>
    );
  }

  const passo = step === "identify" ? 2 : step === "when" ? 1 : 0;

  return (
    <Vitrine organizationName={organizationName} unidade={unidade}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
        <div className="min-w-0">
          {/* A trilha mora DENTRO da coluna do conteúdo. Atravessando a página
              inteira, o terceiro traço ficava por cima do resumo lateral e
              parecia medir o progresso de outra coisa. */}
          <Trilha atual={passo} />
          {/* O recibo.
              Cada escolha feita encolhe para uma linha e continua na tela, com
              o botão que a desfaz. É o que substituiu o "Voltar": trocar o
              serviço é uma ideia que a cliente tem, voltar uma tela é uma
              instrução de navegação — e o recibo ainda responde, no meio do
              caminho, o que ela escolheu e quanto vai custar. */}
          {service && step !== "service" ? (
            <LinhaRecibo
              esmalte={esmalte}
              principal={service.name}
              secundario={`${service.durationMin} min · ${formatBRL(service.priceCents)}`}
              onTrocar={() => setStep("service")}
            />
          ) : null}
          {branch && branches.length > 1 && step !== "service" && step !== "branch" ? (
            <LinhaRecibo
              principal={branch.name}
              secundario={branch.address ?? undefined}
              onTrocar={() => setStep("branch")}
            />
          ) : null}
          {slot && step === "identify" ? (
            <LinhaRecibo
              principal={`${maiuscula(format(new Date(slot.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR }))} às ${slot.label}`}
              secundario={`com ${slot.professionalName}`}
              onTrocar={() => setStep("when")}
            />
          ) : null}

          <h2 className="mt-4 text-ask text-ink">
            {step === "service"
              ? "O que você quer fazer?"
              : step === "branch"
                ? "Em qual unidade?"
                : step === "when"
                  ? "Quando fica bom para você?"
                  : "Só falta você se identificar"}
          </h2>

          {/* 1. Serviço — uma carta de preços, que é como salão mostra serviço. */}
          {step === "service" ? (
            <div className="mt-5 space-y-6">
              {groupByCategory(services).map(([category, list]) => {
                const tom = esmalteDe(category);
                return (
                  <section key={category ?? "sem-categoria"}>
                    <h3 className="mb-2 flex items-center gap-2 text-section">
                      <Gota esmalte={tom} />
                      {category ?? "Serviços"}
                    </h3>
                    <ul className="overflow-hidden rounded-card border border-line bg-surface-raised shadow-card">
                      {list.map((item, i) => (
                        <li key={item.id} className={i > 0 ? "border-t border-line" : undefined}>
                          <button
                            type="button"
                            onClick={() => chooseService(item)}
                            className="group flex w-full items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-accent-soft/45"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-card text-ink">{item.name}</span>
                              {item.description ? (
                                <span className="mt-0.5 line-clamp-2 block text-caption text-ink-secondary">
                                  {item.description}
                                </span>
                              ) : null}
                              <span className="mt-1.5 inline-flex items-center gap-1 text-caption text-ink-secondary">
                                <Clock className="size-3.5 text-ink-tertiary" aria-hidden />
                                {item.durationMin} min
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 pt-0.5">
                              <span className="text-card tabular text-ink">{formatBRL(item.priceCents)}</span>
                              <ChevronRight
                                className="size-4 text-ink-tertiary transition-colors group-hover:text-accent"
                                aria-hidden
                              />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {services.length === 0 ? (
                <Card className="px-4 py-6 text-center">
                  <p className="text-body text-ink">Nada disponível para agendar online</p>
                  <p className="mt-1 text-caption text-ink-secondary">
                    {organizationName} ainda não publicou serviços para agendamento pelo site.
                  </p>
                </Card>
              ) : null}
            </div>
          ) : null}

          {/* 2. Unidade */}
          {step === "branch" ? (
            <ul className="mt-5 grid gap-3">
              {branches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => chooseBranch(item)}
                    className="flex w-full items-center gap-4 rounded-card border border-line bg-surface-raised px-4 py-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-accent/35 hover:shadow-[var(--shadow-card-hover)]"
                  >
                    <MapPin className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-label text-ink">{item.name}</span>
                      {item.address ? (
                        <span className="mt-1 block text-caption text-ink-secondary">{item.address}</span>
                      ) : null}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* 3. Dia e hora, na mesma tela. */}
          {step === "when" ? (
            <div className="mt-5">
              {loadingDays ? (
                <div className="trilha -mx-5 flex gap-2 overflow-hidden px-5 sm:mx-0 sm:px-0">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-[66px] w-[58px] shrink-0" />
                  ))}
                </div>
              ) : availableDays?.length ? (
                <>
                  <p className="mb-2 text-section">{format(dayDate, "MMMM", { locale: ptBR })}</p>
                  {/* A máscara desfaz o corte seco no fim da faixa: sem ela o
                      último cartão fica cerrado ao meio pela borda e lê como
                      defeito de renderização, não como "tem mais para o lado". */}
                  <div
                    role="group"
                    aria-label="Dias com horário livre"
                    className="trilha -mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-40px),transparent_100%)] sm:mx-0 sm:px-0"
                  >
                    {availableDays.map((available, i) => {
                      const date = days.find((item) => format(item, "yyyy-MM-dd") === available.dateISO)!;
                      const ativo = available.dateISO === day;
                      /**
                       * A vira-mês é a única marca de mês dentro da faixa:
                       * repetir "ago" em catorze cartões era ruído, não
                       * informação.
                       *
                       * A comparação é com o cartão ANTERIOR DA LISTA, e não
                       * com o dia 1º: `getPublicAvailableDays` devolve só os
                       * dias que têm vaga, então a faixa pula datas (25, 27,
                       * 30...) e o dia 1º frequentemente não está nela. Marcar
                       * "dia === 1" deixaria a virada de setembro sem nenhum
                       * aviso, que é justamente onde a cliente se perde.
                       */
                      const anteriorISO = i > 0 ? availableDays[i - 1].dateISO : null;
                      const viraMes =
                        anteriorISO !== null && anteriorISO.slice(0, 7) !== available.dateISO.slice(0, 7);
                      return (
                        <button
                          key={available.dateISO}
                          type="button"
                          onClick={() => chooseDay(available.dateISO)}
                          aria-pressed={ativo}
                          // O chip mostra "qui 28"; quem ouve a página precisa
                          // da data por extenso e de quantas vagas restam.
                          aria-label={`${format(date, "EEEE, d 'de' MMMM", { locale: ptBR })} — ${available.slotCount} ${available.slotCount === 1 ? "horário livre" : "horários livres"}`}
                          className={cn(
                            "flex h-[74px] w-[58px] shrink-0 snap-start flex-col items-center justify-center rounded-card border transition-colors",
                            ativo
                              ? "border-accent bg-accent text-white"
                              : "border-line bg-surface-raised text-ink hover:border-line-strong",
                          )}
                        >
                          <span
                            className={cn(
                              "text-meta uppercase tracking-[0.06em]",
                              ativo ? "text-white" : "text-ink-secondary",
                            )}
                          >
                            {WEEKDAY_SHORT[date.getDay()]}
                          </span>
                          <span className="text-title tabular">{format(date, "d")}</span>
                          {/* A linha do mês existe em TODOS os cartões, vazia na
                              maioria. Renderizá-la só na virada empurrava o
                              número para cima naquele cartão e desalinhava a
                              fita inteira — o dia 1º ficava meio dedo mais alto
                              que o 31 ao lado dele. */}
                          <span
                            aria-hidden
                            className={cn("text-meta", ativo ? "text-white" : "text-accent")}
                          >
                            {viraMes ? format(date, "MMM", { locale: ptBR }) : " "}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <p role="status" aria-live="polite" className="sr-only">
                    {loadingSlots
                      ? "Carregando horários"
                      : times.length === 0
                        ? "Nenhum horário livre neste dia"
                        : `${times.length} horários disponíveis`}
                  </p>

                  <div className="mt-6 space-y-5">
                    {loadingSlots ? (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <Skeleton key={i} className="h-11" />
                        ))}
                      </div>
                    ) : times.length === 0 ? (
                      <Card className="px-4 py-6 text-center">
                        <p className="text-body text-ink">Nenhum horário livre neste dia</p>
                        <p className="mt-1 text-caption text-ink-secondary">
                          Escolha outra data na faixa acima.
                        </p>
                      </Card>
                    ) : (
                      <>
                        {manha.length > 0 ? (
                          <TimeGroup label="Manhã" slots={manha} selected={slot} onSelect={setSlot} />
                        ) : null}
                        {tarde.length > 0 ? (
                          <TimeGroup label="Tarde" slots={tarde} selected={slot} onSelect={setSlot} />
                        ) : null}
                        {noite.length > 0 ? (
                          <TimeGroup label="Noite" slots={noite} selected={slot} onSelect={setSlot} />
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <Card className="px-4 py-6 text-center">
                  <p className="text-body text-ink">Nenhum dia livre nas próximas três semanas</p>
                  <p className="mt-1 text-caption text-ink-secondary">
                    Fale com {organizationName} para consultar encaixes ou uma data mais distante.
                  </p>
                </Card>
              )}
            </div>
          ) : null}

          {/* 4. Identificação */}
          {step === "identify" && slot ? (
            <div className="mt-5 space-y-4">
              <Field label="Seu nome" htmlFor="nome">
                <Input
                  id="nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  enterKeyHint="next"
                  placeholder="Nome e sobrenome"
                  className={CAMPO}
                />
              </Field>

              <Field
                label="Celular com DDD"
                htmlFor="fone"
                hint="Serve para a recepção identificar você no dia."
              >
                <Input
                  id="fone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  placeholder="(84) 99999-0000"
                  className={CAMPO}
                />
              </Field>

              {/* O e-mail é opcional e quase ninguém preenche: como campo aberto
                  ele só engorda o formulário no passo em que desistir é mais
                  fácil. Fica atrás de um pedido explícito. */}
              {mostrarEmail ? (
                <Field label="E-mail" htmlFor="email" optional>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                    enterKeyHint="done"
                    placeholder="voce@email.com"
                    className={CAMPO}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => setMostrarEmail(true)}
                  className="inline-flex min-h-11 items-center gap-1.5 text-label text-accent underline-offset-4 hover:underline"
                >
                  <Plus className="size-4" aria-hidden />
                  Adicionar e-mail
                </button>
              )}

              <label className="flex min-h-11 items-center gap-2.5 text-body text-ink-secondary">
                <input
                  type="checkbox"
                  checked={consentMarketing}
                  onChange={(e) => setConsentMarketing(e.target.checked)}
                  className="size-4 shrink-0 rounded-[3px] border-line-strong accent-accent"
                />
                Quero receber novidades de {organizationName}
              </label>

              {error ? (
                <p id="erro-agendamento" role="alert" className="text-caption text-danger">
                  {error}
                </p>
              ) : null}

              <div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={pending}
                  disabled={name.trim().length < 2 || phone.replace(/\D/g, "").length < 10}
                  aria-describedby={error ? "erro-agendamento" : undefined}
                  onClick={submit}
                >
                  Confirmar agendamento
                </Button>
                <p className="mt-3 text-caption text-ink-secondary">
                  Ao confirmar, você autoriza {organizationName} a usar seus dados para gerenciar este
                  atendimento.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <Resumo
          esmalte={esmalte}
          service={service}
          branch={branch}
          slot={slot}
          organizationName={organizationName}
          onContinuar={step === "when" && slot ? () => setStep("identify") : undefined}
        />
      </div>

      {/* Barra de ação do celular: só existe quando há uma escolha para levar
          adiante, e some no desktop, onde o resumo lateral já faz esse papel. */}
      {step === "when" && slot ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface-raised/95 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-sticky backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-[620px] items-center justify-between gap-3">
            <span className="min-w-0 text-caption text-ink-secondary">
              {format(new Date(slot.startsAt), "EEE, d 'de' MMM", { locale: ptBR })} às{" "}
              <span className="text-label text-ink tabular">{slot.label}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => setStep("identify")}>
              Continuar
            </Button>
          </div>
        </div>
      ) : null}
    </Vitrine>
  );
}

/**
 * Moldura da página.
 *
 * O que saiu daqui: uma parede de gradiente roxo que ocupava 620 dos 844 pixels
 * da primeira tela do celular — 73% — para carregar um logotipo, duas linhas de
 * texto e três bolinhas numeradas. O conteúdo da clínica começava abaixo da
 * dobra.
 *
 * O que entrou: o nome da casa como manchete, na mesma serifa do logotipo, e o
 * roxo reduzido a um fio de 4px no topo. Quem abre este link quer ver o salão,
 * não o fornecedor do software — a assinatura da Agenda de Unha continua na
 * página, no rodapé, que é onde ela não custa a atenção de ninguém.
 */
function Vitrine({
  organizationName,
  unidade,
  children,
}: {
  organizationName: string;
  unidade: Branch | null;
  children: React.ReactNode;
}) {
  const digitos = unidade?.phone?.replace(/\D/g, "") ?? "";
  return (
    <main className="flex min-h-dvh flex-col bg-[radial-gradient(120%_60%_at_100%_0,#f2e8fc_0,transparent_58%),var(--color-surface)]">
      <div aria-hidden className="h-1 shrink-0 bg-brand" />
      <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-5 pb-28 sm:px-8 lg:pb-16">
        <header className="pt-7 sm:pt-9">
          <h1 className="font-brand text-house text-ink">{organizationName}</h1>
          {unidade?.address || digitos ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {unidade?.address ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(unidade.address)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 text-caption text-ink-secondary underline-offset-4 transition-colors hover:text-accent hover:underline"
                >
                  <MapPin className="size-3.5 shrink-0 text-ink-tertiary" aria-hidden />
                  {unidade.address}
                </a>
              ) : null}
              {digitos ? (
                <a
                  href={`tel:+${digitos.length > 11 ? digitos : `55${digitos}`}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-caption text-ink-secondary underline-offset-4 transition-colors hover:text-accent hover:underline"
                >
                  <Phone className="size-3.5 shrink-0 text-ink-tertiary" aria-hidden />
                  {unidade!.phone}
                </a>
              ) : null}
            </div>
          ) : null}
        </header>

        {/* `mb-12` e não só o `mt-auto` do rodapé: quando o conteúdo já enche a
            tela o `auto` colapsa para zero e o fio do rodapé encostava na
            última linha do texto legal. */}
        <div className="mt-7 mb-12">{children}</div>

        {/* `mt-auto` e não `mt-12`: com um único serviço publicado o conteúdo
            ocupa um terço da tela, e o rodapé colado nele deixava 500px de nada
            embaixo — como se a página tivesse sido cortada. */}
        <footer className="mt-auto flex items-center gap-2 border-t border-line pb-2 pt-5">
          <BrandLogo compact className="opacity-55 [&_img]:h-6" />
          <span className="text-meta text-ink-secondary">agendamento online</span>
        </footer>
      </div>
    </main>
  );
}

/**
 * Três traços rotulados no lugar de três círculos numerados.
 *
 * O número dentro do círculo não dizia nada que a posição já não dissesse, e o
 * rótulo — que é a informação de verdade — só aparecia no desktop. Aqui a
 * palavra vem sempre, e o preenchimento mostra o quanto já foi andado.
 */
function Trilha({ atual }: { atual: number }) {
  const passos = ["Serviço", "Data e hora", "Seus dados"];
  return (
    <nav aria-label="Etapas do agendamento" className="mb-7 flex gap-2">
      {passos.map((rotulo, i) => (
        <div key={rotulo} className="min-w-0 flex-1" aria-current={i === atual ? "step" : undefined}>
          <div
            className={cn(
              "h-1 rounded-pill transition-colors",
              i <= atual ? "bg-accent" : "bg-line-strong",
            )}
          />
          <p
            className={cn(
              "mt-2 truncate text-meta",
              i === atual ? "font-semibold text-ink" : "text-ink-secondary",
            )}
          >
            {rotulo}
          </p>
        </div>
      ))}
    </nav>
  );
}

/**
 * Uma escolha já feita, encolhida numa linha — com o botão que a desfaz.
 *
 * Vale por dois: substitui o "Voltar" por uma ação que a cliente pensa
 * ("trocar o serviço", não "voltar uma tela") e mantém à vista, do meio do
 * fluxo em diante, o que ela escolheu e quanto vai custar. No celular, onde não
 * há resumo lateral, esta linha é a única resposta para "o que eu marquei
 * mesmo?".
 */
function LinhaRecibo({
  esmalte,
  principal,
  secundario,
  onTrocar,
}: {
  esmalte?: Esmalte;
  principal: string;
  secundario?: string;
  onTrocar: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-card bg-accent-soft/70 py-2 pl-4 pr-2">
      {esmalte ? <Gota esmalte={esmalte} /> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-label text-ink">{principal}</p>
        {secundario ? <p className="truncate text-caption text-ink-secondary">{secundario}</p> : null}
      </div>
      <button
        type="button"
        onClick={onTrocar}
        className="min-h-11 shrink-0 rounded-control px-2.5 text-label font-semibold text-accent underline-offset-4 transition-colors hover:underline"
      >
        Trocar
        <span className="sr-only"> {principal}</span>
      </button>
    </div>
  );
}

/**
 * A gota de esmalte da categoria.
 *
 * O brilho não é enfeite gratuito: é o que faz o círculo ler como esmalte e não
 * como um marcador de lista qualquer. O aro cobre o caso do tom claro demais —
 * um nude puro tem 1,36:1 sobre o branco e simplesmente não aparece.
 */
function Gota({ esmalte, className }: { esmalte: Esmalte; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block size-3 shrink-0 rounded-pill", className)}
      style={{
        backgroundColor: esmalte.fill,
        backgroundImage: "linear-gradient(145deg, rgb(255 255 255 / 0.55), transparent 58%)",
        boxShadow: `inset 0 0 0 1.5px ${esmalte.aro}`,
      }}
    />
  );
}

/**
 * Resumo lateral do desktop.
 *
 * Resolve o vazio que sobrava: o conteúdo ocupava um quinto da largura e o
 * resto era branco. E resolve uma dúvida real — do meio do fluxo em diante a
 * cliente não via mais o que tinha escolhido nem quanto ia custar.
 */
function Resumo({
  esmalte,
  service,
  branch,
  slot,
  organizationName,
  onContinuar,
}: {
  esmalte: Esmalte;
  service: Service | null;
  branch: Branch | null;
  slot: PublicSlot | null;
  organizationName: string;
  /**
   * O "Continuar" do desktop mora AQUI, e não é enfeite de simetria: a barra
   * fixa que leva adiante é `lg:hidden`, então sem este botão o desktop chegava
   * a um beco — horário escolhido, resumo preenchido e nenhuma forma de seguir.
   */
  onContinuar?: () => void;
}) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-8 rounded-card border border-line bg-surface-raised p-5 shadow-card">
        <p className="flex items-center gap-2 text-section">
          <Gota esmalte={esmalte} />
          Sua marcação
        </p>
        <dl className="mt-4 space-y-3.5">
          <LinhaResumo
            rotulo="Serviço"
            valor={service ? `${service.name} · ${service.durationMin} min` : undefined}
          />
          <LinhaResumo
            rotulo="Quando"
            valor={
              slot
                ? maiuscula(format(new Date(slot.startsAt), "EEE, d 'de' MMM", { locale: ptBR })) +
                  ` · ${slot.label}`
                : undefined
            }
          />
          {/* "Com" só aparece depois que há horário: a cliente não escolhe a
              profissional em nenhum passo, então "a escolher" prometeria uma
              tela que não existe. */}
          {slot ? <LinhaResumo rotulo="Com" valor={slot.professionalName} /> : null}
          <LinhaResumo rotulo="Onde" valor={branch?.name ?? organizationName} />
        </dl>
        {service ? (
          <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-label text-ink-secondary">Total</span>
            <span className="text-title tabular text-ink">{formatBRL(service.priceCents)}</span>
          </div>
        ) : null}
        {onContinuar ? (
          <Button variant="primary" size="lg" className="mt-4 w-full" onClick={onContinuar}>
            Continuar
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

function LinhaResumo({ rotulo, valor }: { rotulo: string; valor?: string }) {
  return (
    <div>
      <dt className="text-meta uppercase tracking-[0.06em] text-ink-tertiary">{rotulo}</dt>
      <dd className={cn("mt-0.5 text-label", valor ? "text-ink" : "text-ink-tertiary")}>
        {valor ?? "a escolher"}
      </dd>
    </div>
  );
}

/**
 * O bilhete.
 *
 * É o único lugar da página onde vale gastar movimento e volume: é o momento em
 * que a cliente terminou e vai querer olhar de novo — ou mostrar para alguém. A
 * data vem grande, na serifa da marca, porque é a única informação que ela
 * realmente precisa guardar.
 *
 * O relevo sai de `drop-shadow` no elemento de fora, e não de `box-shadow` no
 * papel: a máscara do picote recortaria a sombra junto e o papel perderia o
 * volume justamente na borda rasgada. `drop-shadow` segue o alfa e contorna
 * cada dente.
 */
function Bilhete({
  confirmation,
  esmalte,
  organizationName,
  service,
  slot,
}: {
  confirmation: BookingConfirmation;
  esmalte: Esmalte;
  organizationName: string;
  service: Service;
  slot: PublicSlot;
}) {
  const inicio = new Date(slot.startsAt);
  // `whenLabel` vem do servidor como "quinta-feira, 28 de agosto às 14:00", já
  // no fuso da clínica. O split é tolerante: se o formato mudar, a linha inteira
  // continua saindo como data e o bilhete não quebra.
  const [dataLabel, horaLabel] = confirmation.whenLabel.split(" às ");

  function adicionarAoCalendario() {
    const ics = montarICS(
      {
        titulo: `${service.name} — ${organizationName}`,
        inicio,
        duracaoMin: service.durationMin,
        local: [confirmation.branchName, confirmation.branchAddress].filter(Boolean).join(" — "),
        descricao: `Com ${confirmation.professionalName}.`,
      },
      `${slot.startsAt}-${slot.professionalId}@agendadeunha`,
    );
    baixarICS(ics, "agendamento.ics");
  }

  return (
    <div className="mx-auto max-w-[520px] animate-rise-in [filter:drop-shadow(0_26px_55px_rgb(67_35_88/0.20))]">
      <div className="picote rounded-t-overlay bg-surface-raised pb-6">
        <div className="px-6 pt-7 sm:px-8">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-positive-soft px-2.5 py-1 text-meta font-semibold uppercase tracking-[0.1em] text-positive">
            <Check className="size-3.5" aria-hidden />
            Confirmado
          </span>
          {/* Data e hora quebram em duas linhas COMANDADAS, não pelo acaso da
              largura: em 390px "quinta-feira, 28 de agosto às 14:00" deixava o
              "14:00" órfão numa segunda linha — justamente o dado que ela
              abriu a tela para conferir. Duas linhas na serifa da marca leem
              como convite; uma linha estourada lê como erro. */}
          <p className="mt-5 font-brand text-house text-ink">{maiuscula(dataLabel)}</p>
          {horaLabel ? <p className="font-brand text-house text-ink tabular">às {horaLabel}</p> : null}
          <p className="mt-2 text-body text-ink-secondary">
            {organizationName} está te esperando.
          </p>
        </div>

        {/* O picote horizontal: a linha por onde o bilhete se destacaria. */}
        <div className="mt-6 flex items-center gap-3 px-6 sm:px-8">
          <Gota esmalte={esmalte} className="size-3.5" />
          <span className="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-line-strong)_0_6px,transparent_6px_12px)]" />
        </div>

        <dl className="mt-5 space-y-3.5 px-6 sm:px-8">
          <LinhaBilhete rotulo="Serviço" valor={confirmation.serviceName} />
          <LinhaBilhete rotulo="Com" valor={confirmation.professionalName} />
          <LinhaBilhete
            rotulo="Onde"
            valor={confirmation.branchName}
            complemento={confirmation.branchAddress ?? undefined}
          />
          <LinhaBilhete rotulo="Valor" valor={formatBRL(service.priceCents)} />
        </dl>

        <div className="mt-6 grid gap-2 px-6 sm:px-8">
          <Button variant="secondary" size="lg" className="w-full" onClick={adicionarAoCalendario}>
            <CalendarPlus className="size-4" aria-hidden />
            Adicionar ao calendário
          </Button>
          {confirmation.branchAddress ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(confirmation.branchAddress)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 text-label text-accent underline-offset-4 hover:underline"
            >
              <MapPin className="size-4" aria-hidden />
              Como chegar
            </a>
          ) : null}
        </div>

        <p className="mt-5 px-6 text-caption text-ink-secondary sm:px-8">
          Para remarcar ou cancelar, fale diretamente com a recepção.
        </p>
      </div>
    </div>
  );
}

function LinhaBilhete({
  rotulo,
  valor,
  complemento,
}: {
  rotulo: string;
  valor: string;
  complemento?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-caption text-ink-secondary">{rotulo}</dt>
      <dd className="min-w-0 text-right">
        <span className="block text-label text-ink">{valor}</span>
        {complemento ? (
          <span className="mt-0.5 block text-caption text-ink-secondary">{complemento}</span>
        ) : null}
      </dd>
    </div>
  );
}

function TimeGroup({
  label,
  slots,
  selected,
  onSelect,
}: {
  label: string;
  slots: PublicSlot[];
  selected: PublicSlot | null;
  onSelect: (slot: PublicSlot) => void;
}) {
  return (
    <section>
      <h3 className="mb-2 text-section">{label}</h3>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6">
        {slots.map((item) => {
          const active = selected?.startsAt === item.startsAt;
          return (
            <button
              key={item.startsAt}
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={active}
              className={cn(
                "h-11 rounded-control border text-body tabular transition-colors duration-[120ms]",
                active
                  ? "border-accent bg-accent font-semibold text-white"
                  : "border-line bg-surface-raised text-ink hover:border-line-strong",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Um muro de 32 chips de 15 em 15 minutos não é escolha, é ruído: acima de 20
 * opções o passo dobra para 30 minutos, contanto que ainda sobrem alternativas.
 */
function thinOut(list: PublicSlot[]): PublicSlot[] {
  if (list.length <= 20) return list;
  const coarse = list.filter((s) => Number(s.label.slice(3, 5)) % 30 === 0);
  return coarse.length >= 8 ? coarse : list;
}

function groupByCategory(services: Service[]): Array<[string | null, Service[]]> {
  const map = new Map<string | null, Service[]>();
  for (const service of services) {
    const key = service.categoryName;
    const list = map.get(key) ?? [];
    list.push(service);
    map.set(key, list);
  }
  return [...map.entries()];
}
