"use client";

import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Check, ChevronRight, Clock, MapPin } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  type BookingConfirmation,
  publicBookingAction,
  publicSlotsAction,
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

type Step = "service" | "branch" | "time" | "identify" | "done";

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
  const [loadingSlots, startSlotsTransition] = useTransition();
  const [slot, setSlot] = useState<PublicSlot | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [pending, startTransition] = useTransition();

  // Próximos 14 dias — escolher data não deve exigir abrir um calendário
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

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
    setStep("time");
    loadSlots({ service: value, branch, day });
  }

  function chooseBranch(value: Branch) {
    setBranch(value);
    setStep("time");
    loadSlots({ service, branch: value, day });
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
      <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center px-5 py-12">
        <div className="flex size-11 items-center justify-center rounded-full bg-positive-soft">
          <Check className="size-5 text-positive" aria-hidden />
        </div>
        <h1 className="mt-5 font-display text-display text-ink">Agendamento confirmado</h1>
        <p className="mt-2 text-body text-ink-secondary">
          Guarde os dados abaixo — não enviamos mensagem de confirmação. Se precisar remarcar ou
          cancelar, fale com a recepção da {organizationName}.
        </p>

        <Card className="mt-7">
          <dl className="divide-y divide-line">
            <Detail label="Serviço" value={confirmation.serviceName} />
            <Detail
              label="Quando"
              value={confirmation.whenLabel.charAt(0).toUpperCase() + confirmation.whenLabel.slice(1)}
            />
            <Detail label="Com" value={confirmation.professionalName} />
            <Detail
              label="Onde"
              value={confirmation.branchName}
              hint={confirmation.branchAddress ?? undefined}
            />
          </dl>
        </Card>

        <Footer />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[440px] px-5 pb-28 pt-6">
      <header>
        {step !== "service" ? (
          <button
            type="button"
            onClick={() =>
              setStep(
                step === "branch"
                  ? "service"
                  : step === "time"
                    ? branches.length > 1
                      ? "branch"
                      : "service"
                    : "time",
              )
            }
            className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1.5 px-1 text-label text-ink-secondary transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Voltar
          </button>
        ) : null}

        <p className="text-section">{organizationName}</p>
        <h1 className="mt-1.5 font-display text-display text-ink">
          {step === "service"
            ? "O que você quer fazer?"
            : step === "branch"
              ? "Em qual unidade?"
              : step === "time"
                ? "Escolha o melhor horário"
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
              <Card>
                <ul className="divide-y divide-line">
                  {list.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => chooseService(item)}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-sunken sm:hover:bg-surface-sunken"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-label text-ink">{item.name}</span>
                          <span className="mt-1 block text-caption text-ink-secondary">
                            {item.durationMin} min · <span className="tabular">{formatBRL(item.priceCents)}</span>
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
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
        <Card className="mt-7">
          <ul className="divide-y divide-line">
            {branches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => chooseBranch(item)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-sunken sm:hover:bg-surface-sunken"
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
        </Card>
      ) : null}

      {/* 3. Data e horário */}
      {step === "time" ? (
        <div className="mt-6">
          <div className="relative -mx-5">
            <div className="overflow-x-auto px-5 pb-1">
              <div className="flex gap-1.5">
                {days.map((date) => {
                  const iso = format(date, "yyyy-MM-dd");
                  const active = iso === day;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => chooseDay(iso)}
                      aria-pressed={active}
                      aria-label={format(date, "EEEE, d 'de' MMMM", { locale: ptBR })}
                      className={cn(
                        "flex min-w-[64px] shrink-0 flex-col items-center rounded-card border px-3 py-2 transition-colors duration-[120ms]",
                        active
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-surface-raised text-ink hover:border-line-strong",
                      )}
                    >
                      <span
                        className={cn(
                          "text-meta uppercase tracking-[0.06em]",
                          active ? "text-white/90" : "text-ink-secondary",
                        )}
                      >
                        {WEEKDAY_SHORT[date.getDay()]}
                      </span>
                      <span className="text-title tabular">{format(date, "d")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Máscara: sinaliza que a fileira de dias continua */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent"
            />
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
            <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-raised/95 px-5 py-3 shadow-sticky backdrop-blur">
              <div className="mx-auto flex max-w-[440px] items-center justify-between gap-3">
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
          <Card className="px-4 py-3">
            <p className="text-body text-ink">
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
    </main>
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
  return <p className="mt-10 text-meta text-ink-secondary">agendamento por Lumina</p>;
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
