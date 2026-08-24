"use client";

import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, CalendarCheck, Check, ChevronRight, Clock, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand";
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

type Branch = { id: number; name: string; address: string | null };

type Step = "service" | "branch" | "day" | "time" | "identify" | "done";

/** Abreviação de 3 letras: o nome por extenso vaza do chip de data. */
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

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

  // Próximos 14 dias — escolher data não deve exigir abrir um calendário
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(new Date(), i)), []);

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
    setStep("day");
    loadDays({ service: value, branch });
  }

  function chooseBranch(value: Branch) {
    setBranch(value);
    setStep("day");
    loadDays({ service, branch: value });
  }

  function chooseDay(value: string) {
    setDay(value);
    setStep("time");
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
          setStep("time");
        }
      }
    });
  }

  // Horários únicos por etiqueta (o cliente escolhe hora, não profissional)
  const times = thinOut(
    slots ? [...new Map(slots.map((s) => [s.label, s])).entries()].map(([, value]) => value) : [],
  );
  const morning = times.filter((s) => Number(s.label.slice(0, 2)) < 12);
  const afternoon = times.filter((s) => Number(s.label.slice(0, 2)) >= 12);
  const dayDate = days.find((d) => format(d, "yyyy-MM-dd") === day) ?? days[0];
  const dayLabel = format(dayDate, "d 'de' MMMM", { locale: ptBR });

  if (step === "done" && confirmation) {
    return (
      <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#f1e5fb_0,transparent_36%),var(--color-surface)] px-5 py-10 sm:py-16">
        <div className="mx-auto max-w-[560px] overflow-hidden rounded-overlay bg-surface-raised shadow-[0_28px_80px_rgb(67_35_88/0.16)]">
          <div className="bg-brand px-7 py-8 text-white sm:px-10">
            <div className="flex size-12 items-center justify-center rounded-pill bg-white/16 ring-1 ring-white/25">
              <Check className="size-6" aria-hidden />
            </div>
            {/* Mesmo gradiente da coluna lateral, mesma conta de contraste:
                sem opacidade em texto, hierarquia por tamanho e peso. */}
            <p className="mt-6 text-eyebrow text-white">Tudo certo</p>
            <h1 className="mt-2 text-display text-white">Seu horário está reservado</h1>
            <p className="mt-2 text-body text-white">{organizationName} espera por você.</p>
          </div>
          <div className="px-7 py-7 sm:px-10">
            <dl className="divide-y divide-line rounded-card border border-line">
              <Detail label="Serviço" value={confirmation.serviceName} />
              <Detail label="Quando" value={confirmation.whenLabel.charAt(0).toUpperCase() + confirmation.whenLabel.slice(1)} />
              <Detail label="Com" value={confirmation.professionalName} />
              <Detail label="Onde" value={confirmation.branchName} hint={confirmation.branchAddress ?? undefined} />
            </dl>
            <p className="mt-5 text-caption text-ink-secondary">
              Para remarcar ou cancelar, fale diretamente com a recepção.
            </p>
            <Footer />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#eee0f9_0,transparent_34%),var(--color-surface)] lg:p-6">
      <div className="mx-auto grid min-h-dvh max-w-[1120px] overflow-hidden bg-surface-raised shadow-[0_30px_90px_rgb(67_35_88/0.14)] lg:min-h-[calc(100dvh-48px)] lg:grid-cols-[360px_minmax(0,1fr)] lg:rounded-overlay">
        <BookingAside
          organizationName={organizationName}
          step={step}
          service={service}
          branch={branch}
          slot={slot}
        />
        <div className="min-w-0 px-5 pb-28 pt-7 sm:px-10 sm:pt-10 lg:px-14 lg:pb-12 lg:pt-12">
      <header>
        {step !== "service" ? (
          <button
            type="button"
            onClick={() =>
              setStep(
                step === "branch"
                  ? "service"
                  : step === "day"
                    ? branches.length > 1
                      ? "branch"
                      : "service"
                    : step === "time"
                      ? "day"
                    : "time",
              )
            }
            className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1.5 px-1 text-label text-ink-secondary transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar
          </button>
        ) : null}

        <p className="text-eyebrow text-accent">Agendamento online</p>
        <h1 className="mt-1.5 text-display text-ink">
          {step === "service"
            ? "O que você quer fazer?"
            : step === "branch"
              ? "Em qual unidade?"
              : step === "day"
                ? "Escolha o dia"
                : step === "time"
                  ? "Agora escolha o horário"
                : "Só falta você se identificar"}
        </h1>
        {service && step !== "service" ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-secondary">
            <span>{service.name}</span>
            <span className="text-ink-tertiary" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3 text-ink-tertiary" aria-hidden />
              {service.durationMin} min
            </span>
            <span className="text-ink-tertiary" aria-hidden>
              ·
            </span>
            <span className="tabular">{formatBRL(service.priceCents)}</span>
          </p>
        ) : null}
      </header>

      {/* 1. Serviço */}
      {step === "service" ? (
        <div className="mt-7 space-y-5">
          {groupByCategory(services).map(([category, list]) => (
            <section key={category ?? "sem-categoria"}>
              {category ? <h2 className="mb-2 text-section">{category}</h2> : null}
              <ul className="grid gap-3 sm:grid-cols-2">
                  {list.map((item) => (
                    <li key={item.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => chooseService(item)}
                        className="group flex h-full min-h-[104px] w-full items-center gap-3 rounded-card border border-line bg-surface-raised px-4 py-4 text-left shadow-card transition-[border-color,box-shadow,transform] duration-200 active:scale-[0.99] sm:hover:-translate-y-0.5 sm:hover:border-accent/35 sm:hover:shadow-[var(--shadow-card-hover)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-card text-ink">{item.name}</span>
                          {item.description ? <span className="mt-1 line-clamp-2 block text-caption text-ink-secondary">{item.description}</span> : null}
                          <span className="mt-1 block text-caption text-ink-secondary">
                            {item.durationMin} min · <span className="tabular">{formatBRL(item.priceCents)}</span>
                          </span>
                        </span>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
                          <ChevronRight className="size-4" aria-hidden />
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {services.length === 0 ? (
            <Card className="px-4 py-6 text-center">
              <p className="text-body text-ink">Nada disponível para agendar online</p>
              <p className="mt-1 text-caption text-ink-secondary">
                Esta clínica ainda não publicou serviços para agendamento pelo site.
              </p>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* 2. Unidade */}
      {step === "branch" ? (
        <ul className="mt-7 grid gap-3">
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

      {/* 3. Dia — só aparecem datas que realmente têm agenda livre. */}
      {step === "day" ? (
        <div className="mt-6">
          <p className="mb-4 text-body text-ink-secondary">Mostramos somente os dias com horários disponíveis nas próximas três semanas.</p>
          {loadingDays ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : availableDays?.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {availableDays.map((available) => {
                const date = days.find((item) => format(item, "yyyy-MM-dd") === available.dateISO)!;
                return (
                  <button key={available.dateISO} type="button" onClick={() => chooseDay(available.dateISO)} className="flex min-h-20 flex-col items-center justify-center rounded-card border border-line bg-surface-raised px-2 py-3 text-ink shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/45">
                    <span className="text-meta uppercase tracking-[0.06em] text-ink-secondary">{WEEKDAY_SHORT[date.getDay()]}</span>
                    <span className="text-title tabular">{format(date, "d")}</span>
                    <span className="text-meta text-accent">{format(date, "MMM", { locale: ptBR })}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Card className="px-4 py-6 text-center"><p className="text-body text-ink">Nenhum dia livre nas próximas três semanas</p><p className="mt-1 text-caption text-ink-secondary">Entre em contato para consultar encaixes ou uma data mais distante.</p></Card>
          )}
        </div>
      ) : null}

      {/* 4. Horário do dia escolhido */}
      {step === "time" ? (
        <div className="mt-6">
          <div className="mb-5 flex items-center justify-between rounded-card border border-line bg-surface-sunken px-4 py-3">
            <div><p className="text-meta uppercase tracking-[0.06em] text-ink-secondary">Dia escolhido</p><p className="text-label text-ink">{dayLabel}</p></div>
            <Button variant="ghost" size="sm" onClick={() => setStep("day")}>Trocar dia</Button>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {loadingSlots
              ? "Carregando horários"
              : times.length === 0
                ? `Nenhum horário livre em ${dayLabel}`
                : `${times.length} horários disponíveis em ${dayLabel}`}
          </p>

          <div className="mt-6 space-y-5">
            {loadingSlots ? (
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : times.length === 0 ? (
              <Card className="px-4 py-6 text-center">
                <p className="text-body text-ink">Nenhum horário livre neste dia</p>
                <p className="mt-1 text-caption text-ink-secondary">
                  Escolha outra data acima — costuma haver vagas nos próximos dias.
                </p>
              </Card>
            ) : (
              <>
                {morning.length > 0 ? (
                  <TimeGroup label="Manhã" slots={morning} selected={slot} onSelect={setSlot} />
                ) : null}
                {afternoon.length > 0 ? (
                  <TimeGroup label="Tarde" slots={afternoon} selected={slot} onSelect={setSlot} />
                ) : null}
              </>
            )}
          </div>

          {slot ? (
            <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-raised/95 px-5 py-3 shadow-sticky backdrop-blur lg:sticky lg:-mx-14 lg:mt-8 lg:px-14">
              <div className="mx-auto flex max-w-[620px] items-center justify-between gap-3">
                <span className="text-caption text-ink-secondary">
                  {format(new Date(slot.startsAt), "d 'de' MMM", { locale: ptBR })} às{" "}
                  <span className="text-label text-ink tabular">{slot.label}</span>
                </span>
                <Button variant="primary" size="lg" onClick={() => setStep("identify")}>
                  Continuar
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 4. Identificação */}
      {step === "identify" && slot ? (
        <div className="mt-7 space-y-4">
          <Card className="flex gap-3 border border-accent/15 bg-accent-soft/60 px-4 py-4 shadow-none">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-accent shadow-card">
              <CalendarCheck className="size-4" aria-hidden />
            </span>
            <div>
            <p className="text-body font-semibold text-ink">
              {format(new Date(slot.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR }).replace(
                /^./,
                (c) => c.toUpperCase(),
              )}{" "}
              às <span className="text-card tabular">{slot.label}</span>
            </p>
            <p className="mt-1 text-caption text-ink-secondary">
              Com {slot.professionalName}
              {branch ? ` · ${branch.name}` : ""}
            </p>
            </div>
          </Card>

          <Field label="Seu nome" htmlFor="nome">
            <Input
              id="nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Nome e sobrenome"
              className="h-11 text-body"
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
              aria-describedby="fone-desc"
              placeholder="(84) 99999-0000"
              className="h-11 text-body"
            />
          </Field>

          <Field label="E-mail" htmlFor="email" optional>
            <Input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="voce@email.com"
              className="h-11 text-body"
            />
          </Field>

          <label className="flex min-h-11 items-center gap-2.5 text-body text-ink-secondary">
            <input
              type="checkbox"
              checked={consentMarketing}
              onChange={(e) => setConsentMarketing(e.target.checked)}
              className="size-4 shrink-0 rounded-[3px] border-line-strong accent-accent"
            />
            Quero receber novidades da clínica
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
              Ao confirmar, você autoriza a {organizationName} a usar seus dados para gerenciar este
              atendimento.
            </p>
          </div>
        </div>
      ) : null}

      <Footer />
        </div>
      </div>
    </main>
  );
}

function BookingAside({
  organizationName,
  step,
  service,
  branch,
  slot,
}: {
  organizationName: string;
  step: Step;
  service: Service | null;
  branch: Branch | null;
  slot: PublicSlot | null;
}) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "service", label: "Serviço" },
    { key: "time", label: "Data e hora" },
    { key: "identify", label: "Seus dados" },
  ];
  const current = step === "branch" ? 0 : step === "day" || step === "time" ? 1 : step === "identify" ? 2 : 0;

  return (
    /**
     * Nenhum texto desta coluna usa transparência.
     *
     * O gradiente da marca começa em #8744cd, e sobre esse roxo o BRANCO PURO
     * já mede só 5,62:1 — o orçamento inteiro de contraste cabe em meio ponto
     * acima do mínimo AA. Qualquer `text-white/xx` gasta esse meio ponto: /70
     * caía para 3,59:1 e /65 para 3,31:1, medidos aqui antes da correção. Por
     * isso a hierarquia é feita por TAMANHO e PESO (26/16/14/13/12/11 px e
     * semibold vs normal), que não custam contraste, e não por opacidade.
     *
     * Pela mesma conta, painel de destaque aqui ESCURECE em vez de clarear:
     * `bg-white/8` clareava o fundo para #9153d1 e derrubava o branco puro para
     * 4,82:1; `bg-night/18` leva o fundo para #733ab0 e devolve 7,13:1.
     */
    <aside className="relative overflow-hidden bg-brand px-5 py-6 text-white sm:px-10 lg:px-9 lg:py-10">
      <div aria-hidden className="absolute -right-20 -top-20 size-64 rounded-pill border border-white/10" />
      <div aria-hidden className="absolute -bottom-24 -left-20 size-72 rounded-pill bg-white/5" />
      <div className="relative">
        <BrandLogo compact variant="white" />
        <div className="mt-4 min-w-0 lg:mt-6">
          <p className="truncate text-label font-semibold text-white">{organizationName}</p>
          <p className="mt-0.5 text-caption text-white">Cuidado no seu tempo</p>
        </div>
      </div>

      <div className="relative mt-6 hidden lg:block">
        <p className="max-w-[260px] text-display text-white">Reserve um momento só para você.</p>
        <p className="mt-3 max-w-[260px] text-body text-white">Escolha o serviço e o melhor horário. Leva menos de dois minutos.</p>
      </div>

      <ol className="relative mt-6 grid grid-cols-3 gap-2 lg:mt-10 lg:block lg:space-y-5">
        {steps.map((item, index) => {
          const active = current === index;
          const complete = current > index;
          return (
            <li key={item.key} className="flex items-center gap-3">
              {/* Os três estados se distinguem por preenchimento, símbolo e
                  força da borda. A borda da etapa futura para em /60 porque é
                  o limiar de 3:1 exigido de contorno de componente (2,80:1 em
                  /55 reprovaria). */}
              <span className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-pill border text-meta font-semibold transition-colors",
                active
                  ? "border-white bg-white text-accent"
                  : complete
                    ? "border-white text-white"
                    : "border-white/60 text-white",
              )}>
                {complete ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={cn("hidden text-label text-white lg:block", active ? "font-semibold" : "font-normal")}>{item.label}</span>
            </li>
          );
        })}
      </ol>

      {service ? (
        <div className="relative mt-10 hidden rounded-card border border-white/25 bg-night/18 p-4 backdrop-blur lg:block">
          <p className="text-meta font-semibold uppercase tracking-[0.1em] text-white">Sua escolha</p>
          <p className="mt-2 text-card text-white">{service.name}</p>
          <p className="mt-1 text-caption text-white">{service.durationMin} min · {formatBRL(service.priceCents)}</p>
          {slot ? <p className="mt-3 border-t border-white/25 pt-3 text-label font-semibold text-white">{slot.label} · {slot.professionalName}</p> : null}
          {branch ? <p className="mt-1 text-caption text-white">{branch.name}</p> : null}
        </div>
      ) : null}

      <div className="relative mt-8 hidden items-center gap-2 text-caption text-white lg:flex">
        <ShieldCheck className="size-4" aria-hidden />
        Seus dados ficam protegidos
      </div>
    </aside>
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
      <h2 className="mb-2 text-section">{label}</h2>
      <div className="grid grid-cols-4 gap-2">
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

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-caption text-ink-secondary">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block text-label text-ink">{value}</span>
        {hint ? <span className="mt-0.5 block text-caption text-ink-secondary">{hint}</span> : null}
      </dd>
    </div>
  );
}

function Footer() {
  return <p className="mt-10 text-meta text-ink-secondary">agendamento por Agenda de Unha</p>;
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
