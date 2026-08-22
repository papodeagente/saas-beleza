"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, CircleDot, LogIn, Play, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatBRL, parseBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { STATUS_LABEL, STATUS_TONE, isClosed, type AppointmentStatus } from "@/domain/appointment-status";
import { registerPaymentAction, updateStatusAction } from "./actions";
import type { AgendaAppointment } from "./agenda-view";

const PAYMENT_METHODS = [
  { value: "pix", label: "PIX" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
  { value: "outro", label: "Outro" },
] as const;

/** A ação principal depende do momento do atendimento — uma só, em destaque. */
function primaryAction(status: string): { next: AppointmentStatus; label: string; icon: typeof Check } | null {
  switch (status) {
    case "scheduled":
      return { next: "confirmed", label: "Confirmar", icon: Check };
    case "confirmed":
      return { next: "checked_in", label: "Fazer check-in", icon: LogIn };
    case "checked_in":
      return { next: "in_progress", label: "Iniciar atendimento", icon: Play };
    case "in_progress":
      return { next: "completed", label: "Concluir", icon: Check };
    default:
      return null;
  }
}

export function AppointmentSheet({
  appointment,
  onClose,
}: {
  appointment: AgendaAppointment;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("pix");
  const [showPayment, setShowPayment] = useState(false);

  const remaining = appointment.priceCents - appointment.paidCents;
  const primary = primaryAction(appointment.status);
  const closed = isClosed(appointment.status);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function changeStatus(next: AppointmentStatus, success: string) {
    run(() => updateStatusAction({ appointmentId: appointment.id, status: next }), success);
  }

  function submitPayment() {
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) {
      toast.error("Informe um valor válido, como 280,00.");
      return;
    }
    run(() => registerPaymentAction({ appointmentId: appointment.id, method, amountCents: cents }), "Pagamento registrado");
    setShowPayment(false);
    setAmount("");
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={appointment.customerName}
        description={`${appointment.serviceName} · ${format(new Date(appointment.startsAt), "d 'de' MMMM', 'HH:mm", { locale: ptBR })}`}
        footer={
          primary ? (
            <Button
              variant="primary"
              size="md"
              disabled={pending}
              onClick={() =>
                changeStatus(
                  primary.next,
                  primary.next === "completed" ? "Atendimento concluído" : `${primary.label} concluído`,
                )
              }
            >
              <primary.icon />
              {primary.label}
            </Button>
          ) : null
        }
      >
        <div className="space-y-5 px-5 py-4">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[appointment.status as keyof typeof STATUS_TONE]}>
              {STATUS_LABEL[appointment.status as AppointmentStatus]}
            </Badge>
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

          <dl className="space-y-2.5">
            <Row label="Horário">
              <span className="tabular">
                {format(new Date(appointment.startsAt), "HH:mm")} –{" "}
                {format(new Date(appointment.endsAt), "HH:mm")}
              </span>
            </Row>
            <Row label="Profissional">
              <span className="flex items-center gap-1.5">
                <Avatar name={appointment.professionalName} size="sm" color={appointment.professionalColor} />
                {appointment.professionalName}
              </span>
            </Row>
            <Row label="Unidade">{appointment.branchName}</Row>
            {appointment.customerPhone ? (
              <Row label="Telefone">{formatPhone(appointment.customerPhone)}</Row>
            ) : null}
          </dl>

          {/* Pagamento — contexto financeiro sem sair da agenda */}
          <div className="rounded-[var(--radius)] border border-line bg-surface px-3.5 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-ink-tertiary">Valor do atendimento</span>
              <span className="text-[15px] font-semibold tabular text-ink">
                {formatBRL(appointment.priceCents)}
              </span>
            </div>
            {appointment.paidCents > 0 ? (
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-[12px] text-ink-tertiary">Recebido</span>
                <span className="text-[13px] tabular text-positive">
                  {formatBRL(appointment.paidCents)}
                </span>
              </div>
            ) : null}
            {remaining > 0 ? (
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-[12px] text-ink-tertiary">Em aberto</span>
                <span className="text-[13px] font-medium tabular text-attention">
                  {formatBRL(remaining)}
                </span>
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-positive">
                <CircleDot className="size-3" />
                Pagamento completo
              </p>
            )}

            {remaining > 0 ? (
              showPayment ? (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <Field label="Valor" htmlFor="valor">
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
                    <select
                      id="metodo"
                      value={method}
                      onChange={(e) => setMethod(e.target.value as typeof method)}
                      className="h-9 w-full rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-2.5 text-[13px] text-ink"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={submitPayment} disabled={pending}>
                      Registrar pagamento
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowPayment(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
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
          </div>

          <Link
            href={`/clientes/${appointment.customerId}`}
            className="flex items-center gap-2 text-[13px] text-accent transition-colors hover:text-accent-hover"
          >
            <User className="size-3.5" />
            Ver ficha completa do cliente
          </Link>

          {!closed ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => changeStatus("cancelled", "Atendimento cancelado")}
              >
                <X />
                Cancelar atendimento
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => changeStatus("no_show", "Registrado como falta")}
              >
                Registrar falta
              </Button>
            </div>
          ) : null}
        </div>

      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[12px] text-ink-tertiary">{label}</dt>
      <dd className="text-[13px] text-ink">{children}</dd>
    </div>
  );
}
