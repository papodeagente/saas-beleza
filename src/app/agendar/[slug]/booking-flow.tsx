"use client";

import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Check, ChevronRight, Clock, MapPin } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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

/** Abreviação fixa: o nome por extenso não cabe no chip de data. */
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function BookingFlow({
  slug,
  organizationName,
  timezone,
  branches,
  services,
}: {
  slug: string;
  organizationName: string;
  timezone: string;
  branches: Branch[];
  services: Service[];
}) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [branch, setBranch] = useState<Branch | null>(branches.length === 1 ? branches[0] : null);
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<PublicSlot | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [pending, startTransition] = useTransition();

  // Próximos 14 dias — escolher data não deve exigir abrir um calendário
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

  useEffect(() => {
    if (step !== "time" || !service) return;
    let active = true;
    setLoadingSlots(true);
    setSlot(null);
    publicSlotsAction({
      slug,
      serviceId: service.id,
      dateISO: day,
      branchId: branch?.id,
    })
      .then((rows) => active && setSlots(rows))
      .finally(() => active && setLoadingSlots(false));
    return () => {
      active = false;
    };
  }, [step, service, day, branch, slug]);

  function chooseService(value: Service) {
    setService(value);
    setStep(branches.length > 1 ? "branch" : "time");
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
  const times = slots
    ? [...new Map(slots.map((s) => [s.label, s])).entries()].map(([, value]) => value)
    : [];
  const morning = times.filter((s) => Number(s.label.slice(0, 2)) < 12);
  const afternoon = times.filter((s) => Number(s.label.slice(0, 2)) >= 12);

  if (step === "done" && confirmation) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center px-6 py-12">
        <div className="flex size-11 items-center justify-center rounded-full bg-positive-soft">
          <Check className="size-5 text-positive" />
        </div>
        <h1 className="mt-5 font-display text-[27px] leading-9 text-ink">Horário confirmado</h1>
        <p className="mt-2 text-[14px] leading-5 text-ink-secondary">
          Seu horário está reservado. A equipe da {organizationName} entra em contato pelo WhatsApp se
          precisar ajustar alguma coisa.
        </p>

        <dl className="mt-7 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
          <Detail label="Serviço" value={confirmation.serviceName} />
          <Detail
            label="Quando"
            value={confirmation.whenLabel.charAt(0).toUpperCase() + confirmation.whenLabel.slice(1)}
          />
          <Detail label="Com" value={confirmation.professionalName} />
          <Detail label="Onde" value={`${organizationName} · ${confirmation.branchName}`} />
        </dl>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[440px] px-5 pb-24 pt-8">
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
            className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Voltar
          </button>
        ) : null}

        <p className="text-[12px] uppercase tracking-[0.08em] text-ink-tertiary">{organizationName}</p>
        <h1 className="mt-1.5 font-display text-[27px] leading-8 text-ink">
          {step === "service"
            ? "O que você quer fazer?"
            : step === "branch"
              ? "Em qual unidade?"
              : step === "time"
                ? "Escolha o melhor horário"
                : "Só falta você se identificar"}
        </h1>
        {service && step !== "service" ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-secondary">
            <span>{service.name}</span>
            <span className="text-ink-tertiary">·</span>
            <span className="inline-flex items-center gap-1 text-ink-tertiary">
              <Clock className="size-3" />
              {service.durationMin} min
            </span>
            <span className="text-ink-tertiary">·</span>
            <span>{formatBRL(service.priceCents)}</span>
          </p>
        ) : null}
      </header>

      {/* 1. Serviço */}
      {step === "service" ? (
        <div className="mt-7 space-y-5">
          {groupByCategory(services).map(([category, list]) => (
            <section key={category ?? "sem-categoria"}>
              {category ? (
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                  {category}
                </h2>
              ) : null}
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
                {list.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => chooseService(item)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-sunken sm:hover:bg-surface-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium text-ink">{item.name}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-tertiary">
                          {item.durationMin} min · {formatBRL(item.priceCents)}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-tertiary" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {services.length === 0 ? (
            <p className="rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-5 text-center text-[13px] text-ink-secondary">
              Esta clínica ainda não abriu serviços para agendamento online.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 2. Unidade */}
      {step === "branch" ? (
        <ul className="mt-7 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
          {branches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setBranch(item);
                  setStep("time");
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-sunken sm:hover:bg-surface-sunken"
              >
                <MapPin className="size-4 shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{item.name}</span>
                  {item.address ? (
                    <span className="mt-0.5 block text-[12px] text-ink-tertiary">{item.address}</span>
                  ) : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 3. Data e horário */}
      {step === "time" ? (
        <div className="mt-6">
          <div className="-mx-5 overflow-x-auto px-5 pb-1">
            <div className="flex gap-1.5">
              {days.map((date) => {
                const iso = format(date, "yyyy-MM-dd");
                const active = iso === day;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setDay(iso)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-[52px] shrink-0 flex-col items-center rounded-[var(--radius)] border py-2 transition-colors duration-[120ms]",
                      active
                        ? "border-accent bg-accent text-white"
                        : "border-line bg-surface-raised text-ink hover:border-line-strong",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-[0.06em]",
                        active ? "text-white/75" : "text-ink-tertiary",
                      )}
                    >
                      {WEEKDAY_SHORT[date.getDay()]}
                    </span>
                    <span className="text-[16px] font-medium tabular leading-6">
                      {format(date, "d")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {loadingSlots ? (
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : times.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-6 text-center">
                <p className="text-[14px] text-ink">Nenhum horário livre neste dia</p>
                <p className="mt-1 text-[13px] text-ink-secondary">
                  Escolha outra data acima — costuma haver vagas nos próximos dias.
                </p>
              </div>
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
            <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-raised/95 px-5 py-3 backdrop-blur">
              <div className="mx-auto flex max-w-[440px] items-center justify-between gap-3">
                <span className="text-[13px] text-ink-secondary">
                  {format(new Date(slot.startsAt), "d 'de' MMM", { locale: ptBR })} às{" "}
                  <span className="font-medium text-ink">{slot.label}</span>
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
          <div className="rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-3">
            <p className="text-[13px] text-ink">
              {format(new Date(slot.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR }).replace(
                /^./,
                (c) => c.toUpperCase(),
              )}{" "}
              às <span className="font-medium">{slot.label}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-ink-tertiary">
              Com {slot.professionalName}
              {branch ? ` · ${branch.name}` : ""}
            </p>
          </div>

          <Field label="Seu nome" htmlFor="nome">
            <Input
              id="nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Nome e sobrenome"
              className="h-11 text-[15px]"
            />
          </Field>

          <Field label="Celular com DDD" htmlFor="fone" hint="É por onde confirmamos seu horário.">
            <Input
              id="fone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(84) 99999-0000"
              className="h-11 text-[15px]"
            />
          </Field>

          <Field label="E-mail (opcional)" htmlFor="email">
            <Input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="voce@email.com"
              className="h-11 text-[15px]"
            />
          </Field>

          {error ? (
            <p role="alert" className="text-[13px] leading-4 text-danger">
              {error}
            </p>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={pending || name.trim().length < 2 || phone.replace(/\D/g, "").length < 10}
            onClick={submit}
          >
            {pending ? "Confirmando…" : "Confirmar agendamento"}
          </Button>
        </div>
      ) : null}
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
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
        {label}
      </h2>
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
                "h-10 rounded-[var(--radius-sm)] border text-[14px] tabular transition-colors duration-[120ms]",
                active
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface-raised text-ink hover:border-accent",
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-[12px] text-ink-tertiary">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{value}</dd>
    </div>
  );
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
