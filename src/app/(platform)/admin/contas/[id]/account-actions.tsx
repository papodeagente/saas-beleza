"use client";

import { AlertTriangle, ArrowLeft, ChevronRight, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  type ActionResult,
  cancelSubscriptionAction,
  changePlanAction,
  convertTrialAction,
  extendTrialAction,
  reactivateSubscriptionAction,
  resumeAccountAction,
  suspendAccountAction,
} from "../actions";

/**
 * Todas as mutações da conta em um painel só.
 *
 * Elas ficam juntas porque são a mesma decisão vista de ângulos diferentes —
 * e porque espalhar sete botões pelo cabeçalho faria o mais perigoso deles
 * (suspender) ter o mesmo peso visual do mais banal.
 *
 * Cancelar e suspender exigem dois cliques: o segundo já sabe o que vai
 * acontecer, escrito na frente.
 */

type PlanOption = {
  id: number;
  name: string;
  monthlyPriceCents: number;
  quarterlyPriceCents: number;
  yearlyPriceCents: number;
  active: boolean;
};

function cycleLabel(cycle: string): string {
  if (cycle === "yearly") return "anual";
  if (cycle === "quarterly") return "trimestral";
  return "mensal";
}

function priceForCycle(plan: PlanOption, cycle: string): number {
  if (cycle === "yearly") return plan.yearlyPriceCents;
  if (cycle === "quarterly") return plan.quarterlyPriceCents;
  return plan.monthlyPriceCents;
}

type SubscriptionSummary = {
  status: string;
  cycle: string;
  planId: number;
  planName: string;
  priceCents: number;
};

type Panel = "plan" | "extend" | "convert" | "cancel" | "reactivate" | "suspend" | "resume";

const PAYING = ["active", "past_due"];

/** Mesma normalização do servidor — aqui só para mostrar o efeito antes do clique. */
function monthlyMrr(status: string, cycle: string, priceCents: number): number {
  if (!PAYING.includes(status)) return 0;
  if (cycle === "yearly") return Math.round(priceCents / 12);
  if (cycle === "quarterly") return Math.round(priceCents / 3);
  return priceCents;
}

export function AccountActions({
  organizationId,
  organizationName,
  suspended,
  subscription,
  plans,
}: {
  organizationId: number;
  organizationName: string;
  suspended: boolean;
  subscription: SubscriptionSummary | null;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [planId, setPlanId] = useState(String(subscription?.planId ?? plans[0]?.id ?? ""));
  const [cycle, setCycle] = useState(subscription?.cycle ?? "monthly");
  const [days, setDays] = useState("7");
  const [cancelReason, setCancelReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");

  function goTo(next: Panel | null) {
    setPanel(next);
    setConfirming(false);
    setError(null);
    setSuccess(null);
  }

  function reset() {
    setOpen(false);
    goTo(null);
    setCancelReason("");
    setSuspendReason("");
    setDays("7");
  }

  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setSuccess(result.message);
      setPanel(null);
      setConfirming(false);
      setCancelReason("");
      setSuspendReason("");
      router.refresh();
    });
  }

  const status = subscription?.status ?? null;
  const selectedPlan = plans.find((p) => String(p.id) === planId);
  const nextPriceCents = selectedPlan ? priceForCycle(selectedPlan, cycle) : 0;
  const mrrBefore = subscription
    ? monthlyMrr(subscription.status, subscription.cycle, subscription.priceCents)
    : 0;
  const mrrAfter = subscription ? monthlyMrr(subscription.status, cycle, nextPriceCents) : 0;

  const options: Array<{ panel: Panel; title: string; description: string; danger?: boolean }> = [];
  if (subscription) {
    options.push({
      panel: "plan",
      title: "Trocar plano ou ciclo",
      description: `Hoje: ${subscription.planName}, ${cycleLabel(subscription.cycle)}.`,
    });
    if (status === "trialing") {
      options.push({
        panel: "convert",
        title: "Converter teste em assinatura",
        description: "Encerra o teste e começa a contar receita a partir de hoje.",
      });
      options.push({
        panel: "extend",
        title: "Estender o teste",
        description: "Empurra o fim do teste. Não muda nada de receita.",
      });
    }
    if (status === "canceled" || status === "paused") {
      options.push({
        panel: "reactivate",
        title: "Reativar assinatura",
        description: `Volta a cobrar ${subscription.planName} e reabre um período.`,
      });
    }
    if (status !== "canceled") {
      options.push({
        panel: "cancel",
        title: "Cancelar assinatura",
        description: "Zera o MRR desta conta a partir de hoje.",
        danger: true,
      });
    }
  }
  options.push(
    suspended
      ? {
          panel: "resume",
          title: "Devolver o acesso",
          description: "A equipe da clínica volta a conseguir entrar.",
        }
      : {
          panel: "suspend",
          title: "Suspender a conta",
          description: "Bloqueia o acesso da clínica inteira. Não mexe na cobrança.",
          danger: true,
        },
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else reset();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="secondary" size="md">
          <Settings2 />
          Gerenciar conta
        </Button>
      </SheetTrigger>

      <SheetContent title="Gerenciar conta" description={organizationName}>
        <div className="px-5 py-4">
          {success ? (
            <p className="mb-3 rounded-card bg-positive-soft px-3 py-2 text-caption text-positive">
              {success}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mb-3 rounded-card bg-danger-soft px-3 py-2 text-caption text-danger">
              {error}
            </p>
          ) : null}

          {panel === null ? (
            <ul className="space-y-1.5">
              {options.map((option) => (
                <li key={option.panel}>
                  <button
                    type="button"
                    onClick={() => goTo(option.panel)}
                    className="flex w-full items-center gap-3 rounded-card border border-line px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-label",
                          option.danger ? "text-danger" : "text-ink",
                        )}
                      >
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-caption text-ink-secondary">
                        {option.description}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
                  </button>
                </li>
              ))}
              {!subscription ? (
                <li className="rounded-card bg-surface px-3 py-2.5 text-caption text-ink-secondary">
                  Sem assinatura: só as ações de acesso estão disponíveis.
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => goTo(null)}
                className="inline-flex items-center gap-1.5 text-label text-ink-secondary transition-colors hover:text-ink"
              >
                <ArrowLeft className="size-3.5" />
                Todas as ações
              </button>

              {panel === "plan" && subscription ? (
                <div className="space-y-3">
                  <Field label="Plano" htmlFor="plano">
                    <Select
                      id="plano"
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value)}
                    >
                      {plans.map((plan) => (
                        <option key={plan.id} value={String(plan.id)}>
                          {plan.name}
                          {plan.active ? "" : " (fora de linha)"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Ciclo" htmlFor="ciclo">
                    <Select id="ciclo" value={cycle} onChange={(e) => setCycle(e.target.value)}>
                      <option value="monthly">Mensal</option>
                      <option value="quarterly">Trimestral</option>
                      <option value="yearly">Anual</option>
                    </Select>
                  </Field>

                  <div className="rounded-card bg-surface px-3 py-2.5">
                    <p className="text-caption text-ink-secondary">
                      Novo preço travado:{" "}
                      <span className="tabular text-ink">{formatBRL(nextPriceCents)}</span>
                      {cycle === "yearly" ? " por ano" : cycle === "quarterly" ? " por trimestre" : " por mês"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
                      <span className="tabular">
                        MRR {formatBRL(mrrBefore)} → {formatBRL(mrrAfter)}
                      </span>
                      {mrrAfter !== mrrBefore ? (
                        <Badge tone={mrrAfter > mrrBefore ? "positive" : "danger"}>
                          {mrrAfter > mrrBefore ? "+" : "−"}
                          {formatBRL(Math.abs(mrrAfter - mrrBefore))}
                        </Badge>
                      ) : null}
                    </p>
                    {subscription.status === "trialing" ? (
                      <p className="mt-1 text-meta text-ink-tertiary">
                        Em teste o MRR é zero dos dois lados — a troca só passa a valer receita na
                        conversão.
                      </p>
                    ) : null}
                  </div>

                  <Button
                    variant="primary"
                    size="md"
                    loading={pending}
                    onClick={() =>
                      run(() =>
                        changePlanAction({ organizationId, planId: Number(planId), cycle }),
                      )
                    }
                  >
                    Salvar plano
                  </Button>
                </div>
              ) : null}

              {panel === "convert" && subscription ? (
                <div className="space-y-3">
                  <p className="text-body text-ink-secondary">
                    O teste é encerrado hoje e a assinatura de{" "}
                    <strong className="text-ink">{subscription.planName}</strong> passa a valer{" "}
                    <span className="tabular text-ink">
                      {formatBRL(
                        monthlyMrr("active", subscription.cycle, subscription.priceCents),
                      )}
                    </span>{" "}
                    de MRR.
                  </p>
                  <Button
                    variant="primary"
                    size="md"
                    loading={pending}
                    onClick={() => run(() => convertTrialAction({ organizationId }))}
                  >
                    Converter em assinatura
                  </Button>
                </div>
              ) : null}

              {panel === "extend" ? (
                <div className="space-y-3">
                  <Field
                    label="Dias a acrescentar"
                    htmlFor="dias"
                    hint="Teste vencido volta a contar de hoje. Não gera evento de receita."
                  >
                    <Input
                      id="dias"
                      type="number"
                      min={1}
                      max={90}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className="w-28"
                    />
                  </Field>
                  <Button
                    variant="primary"
                    size="md"
                    loading={pending}
                    onClick={() => run(() => extendTrialAction({ organizationId, days }))}
                  >
                    Estender teste
                  </Button>
                </div>
              ) : null}

              {panel === "reactivate" && subscription ? (
                <div className="space-y-3">
                  <p className="text-body text-ink-secondary">
                    Reabre um período de <strong className="text-ink">{subscription.planName}</strong>{" "}
                    a partir de hoje e devolve{" "}
                    <span className="tabular text-ink">
                      {formatBRL(monthlyMrr("active", subscription.cycle, subscription.priceCents))}
                    </span>{" "}
                    ao MRR.
                  </p>
                  <Button
                    variant="primary"
                    size="md"
                    loading={pending}
                    onClick={() => run(() => reactivateSubscriptionAction({ organizationId }))}
                  >
                    Reativar assinatura
                  </Button>
                </div>
              ) : null}

              {panel === "cancel" && subscription ? (
                <div className="space-y-3">
                  <Field
                    label="Motivo do cancelamento"
                    htmlFor="motivo-cancelamento"
                    hint="Fica no histórico da conta e no evento de receita."
                  >
                    <Textarea
                      id="motivo-cancelamento"
                      rows={3}
                      value={cancelReason}
                      onChange={(e) => {
                        setCancelReason(e.target.value);
                        setConfirming(false);
                      }}
                      placeholder="Ex.: pediu cancelamento por telefone, fechou a clínica."
                    />
                  </Field>
                  <Aviso>
                    O MRR desta conta cai de{" "}
                    <span className="tabular">{formatBRL(mrrBefore)}</span> para{" "}
                    <span className="tabular">{formatBRL(0)}</span> hoje. O acesso continua até você
                    suspender a conta.
                  </Aviso>
                  {confirming ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="danger"
                        size="md"
                        loading={pending}
                        onClick={() =>
                          run(() =>
                            cancelSubscriptionAction({ organizationId, reason: cancelReason }),
                          )
                        }
                      >
                        Confirmar cancelamento
                      </Button>
                      <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
                        Voltar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="danger"
                      size="md"
                      disabled={cancelReason.trim().length < 3}
                      onClick={() => setConfirming(true)}
                    >
                      Cancelar assinatura
                    </Button>
                  )}
                </div>
              ) : null}

              {panel === "suspend" ? (
                <div className="space-y-3">
                  <Field
                    label="Motivo da suspensão"
                    htmlFor="motivo-suspensao"
                    hint="A clínica não vê este texto, mas ele explica a decisão para quem vier depois."
                  >
                    <Textarea
                      id="motivo-suspensao"
                      rows={3}
                      value={suspendReason}
                      onChange={(e) => {
                        setSuspendReason(e.target.value);
                        setConfirming(false);
                      }}
                      placeholder="Ex.: inadimplência de 45 dias sem resposta."
                    />
                  </Field>
                  <Aviso>
                    Todo mundo da clínica perde o acesso na hora — inclusive a dona da conta. A
                    assinatura e a cobrança não mudam.
                  </Aviso>
                  {confirming ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="danger"
                        size="md"
                        loading={pending}
                        onClick={() =>
                          run(() => suspendAccountAction({ organizationId, reason: suspendReason }))
                        }
                      >
                        Confirmar suspensão
                      </Button>
                      <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
                        Voltar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="danger"
                      size="md"
                      disabled={suspendReason.trim().length < 3}
                      onClick={() => setConfirming(true)}
                    >
                      Suspender conta
                    </Button>
                  )}
                </div>
              ) : null}

              {panel === "resume" ? (
                <div className="space-y-3">
                  <p className="text-body text-ink-secondary">
                    A equipe volta a conseguir entrar imediatamente. A assinatura permanece como
                    está.
                  </p>
                  <Button
                    variant="primary"
                    size="md"
                    loading={pending}
                    onClick={() => run(() => resumeAccountAction({ organizationId }))}
                  >
                    Devolver o acesso
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-card bg-danger-soft px-3 py-2.5 text-caption text-danger">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
