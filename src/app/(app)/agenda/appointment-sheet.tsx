"use client";

import { CalendarClock, Check, LogIn, Play, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, DataRow } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfessionalDot } from "@/components/ui/status-stripe";
import { STATUS_LABEL, STATUS_TONE, isClosed, type AppointmentStatus } from "@/domain/appointment-status";
import { formatBRL, parseBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  type SlotOption,
  fetchRescheduleSlotsAction,
  registerPaymentAction,
  rescheduleAction,
  updateStatusAction,
} from "./actions";
import type { AgendaAppointment } from "./agenda-view";

const PAYMENT_METHODS = [
  { value: "pix", label: "PIX" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
  { value: "outro", label: "Outro" },
] as const;

/**
 * A ação principal depende do momento do atendimento — uma só, em destaque.
 * O aviso de sucesso repete o verbo do botão: quem clicou "Confirmar" lê
 * "Atendimento confirmado", nunca outra palavra.
 */
function primaryAction(
  status: string,
): { next: AppointmentStatus; label: string; success: string; icon: typeof Check } | null {
  switch (status) {
    case "scheduled":
      return { next: "confirmed", label: "Confirmar", success: "Atendimento confirmado", icon: Check };
    case "confirmed":
      return { next: "checked_in", label: "Fazer check-in", success: "Check-in registrado", icon: LogIn };
    case "checked_in":
      return {
        next: "in_progress",
        label: "Iniciar atendimento",
        success: "Atendimento iniciado",
        icon: Play,
      };
    case "in_progress":
      return { next: "completed", label: "Concluir", success: "Atendimento concluído", icon: Check };
    default:
      return null;
  }
}

export function AppointmentSheet({
  appointment,
  timezone,
  professionals,
  onClose,
}: {
  appointment: AgendaAppointment;
  timezone: string;
  professionals: Array<{ id: number; name: string; color: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("pix");
  const [showPayment, setShowPayment] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  // Remarcar reaproveita a mesma consulta de horários livres do agendamento novo.
  const [rescheduling, setRescheduling] = useState(false);
  const [day, setDay] = useState(() => formatTz(new Date(appointment.startsAt), timezone, "yyyy-MM-dd"));
  const [professionalId, setProfessionalId] = useState<number>(appointment.professionalId);
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [loadingSlots, startSlotsTransition] = useTransition();
  const [slot, setSlot] = useState<SlotOption | null>(null);

  const remaining = appointment.priceCents - appointment.paidCents;
  const primary = primaryAction(appointment.status);
  const closed = isClosed(appointment.status);
  const status = appointment.status as AppointmentStatus;

  /** Qual botão disparou a transição — é ele que gira, não todos. */
  function run(
    tag: string,
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    success: string,
  ) {
    setRunning(tag);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setRunning(null);
    });
  }

  function changeStatus(tag: string, next: AppointmentStatus, success: string) {
    run(tag, () => updateStatusAction({ appointmentId: appointment.id, status: next }), success);
  }

  function submitPayment() {
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) {
      toast.error("Informe um valor válido, como 280,00.");
      return;
    }
    run(
      "payment",
      () => registerPaymentAction({ appointmentId: appointment.id, method, amountCents: cents }),
      "Pagamento registrado",
    );
    setShowPayment(false);
    setAmount("");
  }

  function loadSlots(next: { day: string; professionalId: number }) {
    setSlot(null);
    startSlotsTransition(async () => {
      const rows = await fetchRescheduleSlotsAction({
        appointmentId: appointment.id,
        dateISO: next.day,
        professionalId: next.professionalId,
      });
      setSlots(rows);
    });
  }

  function openReschedule() {
    setRescheduling(true);
    setShowPayment(false);
    loadSlots({ day, professionalId });
  }

  function submitReschedule() {
    if (!slot) return;
    setRunning("reschedule");
    startTransition(async () => {
      const result = await rescheduleAction({
        appointmentId: appointment.id,
        startsAt: slot.startsAt,
        professionalId: slot.professionalId,
      });
      if (result.ok) {
        toast.success("Atendimento remarcado");
        setRescheduling(false);
        setSlot(null);
        router.refresh();
      } else {
        toast.error(result.error);
        const fresh = await fetchRescheduleSlotsAction({
          appointmentId: appointment.id,
          dateISO: day,
          professionalId,
        });
        setSlots(fresh);
        setSlot(null);
      }
      setRunning(null);
    });
  }

  // O mesmo "14:30" não aparece uma vez por profissional.
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
        title={appointment.customerName}
        description={`${appointment.serviceName} · ${formatTz(new Date(appointment.startsAt), timezone, "d 'de' MMMM', 'HH:mm")}`}
        footer={
          rescheduling ? (
            <>
              <Button variant="ghost" size="md" onClick={() => setRescheduling(false)}>
                Voltar
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={pending && running === "reschedule"}
                disabled={!slot}
                onClick={submitReschedule}
              >
                <CalendarClock />
                Remarcar
              </Button>
            </>
          ) : primary ? (
            <Button
              variant="primary"
              size="md"
              loading={pending && running === "primary"}
              onClick={() => changeStatus("primary", primary.next, primary.success)}
            >
              <primary.icon />
              {primary.label}
            </Button>
          ) : null
        }
      >
        <div className="space-y-5 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            {appointment.source !== "admin" ? (
              <Badge tone="neutral">
                {appointment.source === "ai"
                  ? "Agendado pela IA"
                  : appointment.source === "public"
                    ? "Agendamento online"
                    : "Via WhatsApp"}
              </Badge>
            ) : null}
          </div>

          {rescheduling ? (
            <div className="space-y-4">
              <p className="text-caption text-ink-secondary">
                Escolha a nova data e o novo horário. A duração do serviço é mantida.
              </p>

              <Field label="Data" htmlFor="remarcar-data">
                <Input
                  id="remarcar-data"
                  type="date"
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                    loadSlots({ day: e.target.value, professionalId });
                  }}
                />
              </Field>

              <Field label="Profissional" htmlFor="remarcar-profissional">
                <Select
                  id="remarcar-profissional"
                  value={professionalId}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setProfessionalId(value);
                    loadSlots({ day, professionalId: value });
                  }}
                >
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div>
                <span className="mb-1.5 block text-label text-ink">Horário livre</span>
                {loadingSlots ? (
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : grouped.length === 0 ? (
                  <p className="rounded-control border border-line bg-surface px-3 py-3 text-caption text-ink-secondary">
                    Esse profissional não tem horário livre nesta data. Tente outro dia ou outro
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
              </div>
            </div>
          ) : (
            <>
              <Card inset className="px-3.5 py-2.5">
                <dl>
                  <DataRow label="Horário">
                    <span className="tabular">
                      {formatTz(new Date(appointment.startsAt), timezone, "HH:mm")} –{" "}
                      {formatTz(new Date(appointment.endsAt), timezone, "HH:mm")}
                    </span>
                  </DataRow>
                  <DataRow label="Profissional">
                    <span className="flex items-center justify-end gap-1.5">
                      <ProfessionalDot color={appointment.professionalColor} />
                      {appointment.professionalName}
                    </span>
                  </DataRow>
                  <DataRow label="Unidade">{appointment.branchName}</DataRow>
                  {appointment.customerPhone ? (
                    <DataRow label="Telefone">{formatPhone(appointment.customerPhone)}</DataRow>
                  ) : null}
                </dl>
              </Card>

              {/* Pagamento — contexto financeiro sem sair da agenda */}
              <Card inset className="px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-caption text-ink-secondary">Valor do atendimento</span>
                  <span className="text-label font-semibold tabular text-ink">
                    {formatBRL(appointment.priceCents)}
                  </span>
                </div>
                {appointment.paidCents > 0 ? (
                  <div className="mt-1.5 flex items-baseline justify-between gap-4">
                    <span className="text-caption text-ink-secondary">Recebido</span>
                    <span className="text-label tabular text-positive">
                      {formatBRL(appointment.paidCents)}
                    </span>
                  </div>
                ) : null}
                {remaining > 0 ? (
                  <div className="mt-1.5 flex items-baseline justify-between gap-4">
                    <span className="text-caption text-ink-secondary">Em aberto</span>
                    <span className="text-label font-medium tabular text-attention">
                      {formatBRL(remaining)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-caption text-positive">
                    <Check className="size-3.5" />
                    Pagamento completo
                  </p>
                )}

                {remaining > 0 ? (
                  showPayment ? (
                    <div className="mt-3 space-y-3 border-t border-line pt-3">
                      <Field label="Valor recebido" htmlFor="valor">
                        <Input
                          id="valor"
                          inputMode="decimal"
                          autoFocus
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder={(remaining / 100).toFixed(2).replace(".", ",")}
                        />
                      </Field>
                      <Field label="Forma de pagamento" htmlFor="metodo">
                        <Select
                          id="metodo"
                          value={method}
                          onChange={(e) => setMethod(e.target.value as typeof method)}
                        >
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="flex gap-2">
                        <Button variant="primary" size="md" onClick={submitPayment} loading={pending && running === "payment"}>
                          Registrar pagamento
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => setShowPayment(false)}>
                          Voltar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="md"
                      className="mt-3 w-full"
                      onClick={() => {
                        setShowPayment(true);
                        setAmount((remaining / 100).toFixed(2).replace(".", ","));
                      }}
                    >
                      Registrar pagamento
                    </Button>
                  )
                ) : null}
              </Card>

              <Link
                href={`/clientes/${appointment.customerId}`}
                // O bordeaux fica reservado à ação primária e à seleção: aqui o
                // sublinhado já diz que é um link.
                className="flex items-center gap-2 text-label text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
              >
                <User className="size-3.5" />
                Ver ficha completa do cliente
              </Link>

              {!closed ? (
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button variant="secondary" size="md" disabled={pending} onClick={openReschedule}>
                    <CalendarClock />
                    Remarcar
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={pending}
                    loading={pending && running === "cancel"}
                    onClick={() => changeStatus("cancel", "cancelled", "Atendimento cancelado")}
                  >
                    <X />
                    Cancelar atendimento
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={pending}
                    loading={pending && running === "noshow"}
                    onClick={() => changeStatus("noshow", "no_show", "Falta registrada")}
                  >
                    Registrar falta
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
