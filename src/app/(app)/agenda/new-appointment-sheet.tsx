"use client";

import { Check, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  type SlotOption,
  createAppointmentAction,
  fetchSlotsAction,
  searchCustomersAction,
} from "./actions";
import type { AgendaFormData } from "./agenda-view";

type Customer = { id: number; name: string; phone: string | null; lastVisitAt: Date | string | null };

/**
 * Agendamento rápido: cliente → serviço → horário.
 * Unidade, duração, preço e recurso são inferidos — não se pergunta o que o
 * sistema já sabe. Quando o painel nasce de um clique na grade, profissional,
 * data e horário já vêm preenchidos.
 */
export function NewAppointmentSheet({
  dateISO,
  timezone,
  formData,
  defaultProfessionalId,
  defaultStartsAt,
  onClose,
}: {
  dateISO: string;
  timezone: string;
  formData: AgendaFormData;
  defaultProfessionalId?: number;
  /** Instante escolhido na grade (ISO). Vira o horário pré-selecionado. */
  defaultStartsAt?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);

  const [serviceId, setServiceId] = useState<number | null>(null);
  const [professionalId, setProfessionalId] = useState<number | null>(defaultProfessionalId ?? null);
  const [day, setDay] = useState(
    defaultStartsAt ? formatTz(new Date(defaultStartsAt), timezone, "yyyy-MM-dd") : dateISO,
  );

  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [loadingSlots, startSlotsTransition] = useTransition();
  const [slot, setSlot] = useState<SlotOption | null>(null);

  // Horário pedido pelo clique na grade: aplicado assim que a lista de livres chega.
  const wanted = useRef<string | null>(defaultStartsAt ?? null);
  const [wantedTaken, setWantedTaken] = useState<string | null>(null);

  const service = formData.services.find((s) => s.id === serviceId) ?? null;
  const startLabel = defaultStartsAt ? formatTz(new Date(defaultStartsAt), timezone, "HH:mm") : null;

  // Busca de cliente sempre no servidor — nunca filtra só o que já veio na tela
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const rows = await searchCustomersAction(query);
      if (active) setResults(rows as Customer[]);
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  /**
   * A busca de horários nasce de uma ação do usuário (trocar serviço,
   * profissional ou data), então roda numa transição em vez de um efeito —
   * o estado de carregamento vem do próprio React, sem render em cascata.
   */
  function loadSlots(next: { serviceId: number | null; professionalId: number | null; day: string }) {
    setSlot(null);
    if (!next.serviceId) {
      setSlots(null);
      return;
    }
    startSlotsTransition(async () => {
      const rows = await fetchSlotsAction({
        serviceId: next.serviceId!,
        dateISO: next.day,
        professionalId: next.professionalId ?? undefined,
      });
      setSlots(rows);
      const target = wanted.current;
      if (target) {
        wanted.current = null;
        const match = rows.find((r) => r.startsAt === target);
        if (match) setSlot(match);
        else setWantedTaken(formatTz(new Date(target), timezone, "HH:mm"));
      }
    });
  }

  function submit() {
    if (!customer || !service || !slot) return;
    startTransition(async () => {
      const result = await createAppointmentAction({
        customerId: customer.id,
        serviceId: service.id,
        professionalId: slot.professionalId,
        branchId: slot.branchId,
        startsAt: slot.startsAt,
        resourceId: slot.resourceId,
      });
      if (result.ok) {
        toast.success(`${service.name} agendado para ${customer.name} às ${slot.label}`);
        router.refresh();
        onClose();
      } else {
        toast.error(result.error);
        // O horário pode ter sido ocupado por outra pessoa — recarrega a grade
        const fresh = await fetchSlotsAction({
          serviceId: service.id,
          dateISO: day,
          professionalId: professionalId ?? undefined,
        });
        setSlots(fresh);
        setSlot(null);
      }
    });
  }

  // Horários agrupados: o mesmo "14:30" não aparece uma vez por profissional
  const grouped = slots
    ? Array.from(
        slots.reduce((map, s) => {
          const list = map.get(s.label) ?? [];
          list.push(s);
          map.set(s.label, list);
          return map;
        }, new Map<string, SlotOption[]>()),
      )
    : [];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title="Novo atendimento"
        description={
          startLabel
            ? `Horário escolhido na agenda: ${startLabel}. Falta o cliente e o serviço.`
            : "Escolha o cliente, o serviço e o horário."
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!customer || !service || !slot}
              loading={pending}
              onClick={submit}
            >
              <Check />
              Agendar
            </Button>
          </>
        }
      >
        <div className="space-y-5 px-5 py-4">
          {/* 1. Cliente */}
          <div>
            <span className="mb-1.5 block text-label text-ink">Cliente</span>
            {customer ? (
              <div className="flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2">
                <Avatar name={customer.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-ink">{customer.name}</span>
                  {customer.phone ? (
                    <span className="block text-caption text-ink-secondary">
                      {formatPhone(customer.phone)}
                    </span>
                  ) : null}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-tertiary" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por nome ou telefone"
                    className="pl-8"
                    aria-label="Buscar cliente"
                  />
                </div>
                {results.length > 0 ? (
                  <ul className="mt-1.5 max-h-[188px] divide-y divide-line overflow-y-auto rounded-control border border-line">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setCustomer(c)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                        >
                          <Avatar name={c.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label text-ink">{c.name}</span>
                            {c.phone ? (
                              <span className="block text-caption text-ink-secondary">
                                {formatPhone(c.phone)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : query.trim() ? (
                  <p className="mt-2 text-caption text-ink-secondary">
                    Nenhum cliente encontrado com esse nome ou telefone.
                  </p>
                ) : null}
              </>
            )}
          </div>

          {/* 2. Serviço */}
          <Field label="Serviço" htmlFor="servico">
            <Select
              id="servico"
              value={serviceId ?? ""}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : null;
                setServiceId(value);
                loadSlots({ serviceId: value, professionalId, day });
              }}
            >
              <option value="">Selecione o serviço</option>
              {formData.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.durationMin}min · {formatBRL(s.priceCents)}
                </option>
              ))}
            </Select>
          </Field>

          {/* 3. Profissional (opcional — vazio significa "quem estiver livre") */}
          <Field
            label="Profissional"
            htmlFor="profissional"
            hint="Deixe em branco para ver todos os horários livres."
          >
            <Select
              id="profissional"
              value={professionalId ?? ""}
              onChange={(e) => {
                const value = e.target.value ? Number(e.target.value) : null;
                setProfessionalId(value);
                loadSlots({ serviceId, professionalId: value, day });
              }}
            >
              <option value="">Qualquer profissional</option>
              {formData.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Data" htmlFor="data">
            <Input
              id="data"
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                loadSlots({ serviceId, professionalId, day: e.target.value });
              }}
            />
          </Field>

          {/* 4. Horário */}
          {serviceId ? (
            <div>
              <span className="mb-1.5 block text-label text-ink">Horário</span>
              {loadingSlots ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-9" />
                  ))}
                </div>
              ) : grouped.length === 0 ? (
                <p className="rounded-control border border-line bg-surface px-3 py-3 text-caption text-ink-secondary">
                  Não há horário livre neste dia para esse serviço. Tente outra data ou outro
                  profissional.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {grouped.map(([label, options]) => {
                    const active = slot?.label === label;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setSlot(options[0])}
                        aria-pressed={active}
                        className={cn(
                          "h-9 rounded-control border text-label tabular transition-colors duration-[120ms]",
                          active
                            ? "border-accent bg-accent text-white"
                            : "border-line-strong bg-surface-raised text-ink hover:border-ink-tertiary",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {wantedTaken && !slot ? (
                <p className="mt-2 text-caption text-attention">
                  {wantedTaken} não está livre para esse serviço. Escolha um dos horários acima.
                </p>
              ) : null}
              {slot && !professionalId ? (
                <p className="mt-2 text-caption text-ink-secondary">
                  Será atendido por {slot.professionalName}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
