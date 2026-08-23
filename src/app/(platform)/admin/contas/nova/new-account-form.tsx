"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createAccountAction } from "../actions";

type Plano = {
  id: number;
  name: string;
  description: string | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  trialDays: number;
};

const FUSOS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Rio_Branco",
  "America/Noronha",
];

export function NewAccountForm({ planos }: { planos: Plano[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erros, setErros] = useState<Record<string, string>>({});

  const [clinicName, setClinicName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [planId, setPlanId] = useState(planos[0]?.id ?? 0);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [start, setStart] = useState<"trial" | "active">("trial");

  const plano = planos.find((p) => p.id === planId) ?? planos[0];
  const preco = plano
    ? cycle === "yearly"
      ? plano.yearlyPriceCents
      : plano.monthlyPriceCents
    : 0;

  function salvar() {
    setErros({});
    startTransition(async () => {
      const resultado = await createAccountAction({
        clinicName,
        timezone,
        ownerName,
        ownerEmail,
        ownerPassword,
        planId,
        cycle,
        start,
      });

      if (resultado.ok) {
        toast.success(resultado.message);
        router.push(`/admin/contas/${resultado.organizationId}`);
      } else if (resultado.fields) {
        setErros(resultado.fields);
      } else {
        toast.error(resultado.error);
      }
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <section>
        <h2 className="text-section">A clínica</h2>
        <Card className="mt-3 space-y-4 px-5 py-4">
          <Field label="Nome da clínica" htmlFor="clinic-name" error={erros.clinicName}>
            <Input
              id="clinic-name"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              placeholder="Clínica Bela Face"
              autoFocus
              aria-invalid={erros.clinicName ? true : undefined}
            />
          </Field>

          <Field
            label="Fuso horário"
            htmlFor="timezone"
            hint="Define o horário da agenda e dos relatórios da clínica."
          >
            <Select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {FUSOS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      </section>

      <section>
        <h2 className="text-section">Quem responde pela conta</h2>
        <Card className="mt-3 space-y-4 px-5 py-4">
          <Field label="Nome" htmlFor="owner-name" error={erros.ownerName}>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Maria Fernandes"
              aria-invalid={erros.ownerName ? true : undefined}
            />
          </Field>

          <Field
            label="E-mail"
            htmlFor="owner-email"
            error={erros.ownerEmail}
            hint="É com este e-mail que a pessoa entra no sistema."
          >
            <Input
              id="owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="maria@clinicabelaface.com.br"
              aria-invalid={erros.ownerEmail ? true : undefined}
            />
          </Field>

          <Field
            label="Senha inicial"
            htmlFor="owner-password"
            error={erros.ownerPassword}
            hint="Mínimo de 8 caracteres. Combine com a cliente e peça que ela troque no primeiro acesso."
          >
            <Input
              id="owner-password"
              type="text"
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              placeholder="senha temporária"
              aria-invalid={erros.ownerPassword ? true : undefined}
            />
          </Field>
        </Card>
      </section>

      <section>
        <h2 className="text-section">Plano</h2>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {planos.map((p) => {
            const escolhido = p.id === planId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlanId(p.id)}
                aria-pressed={escolhido}
                className={cn(
                  "rounded-card border px-4 py-3 text-left transition-colors",
                  escolhido
                    ? "border-accent bg-accent/5 ring-1 ring-accent"
                    : "border-line bg-surface-raised hover:border-line-strong",
                )}
              >
                <span className="block text-label text-ink">{p.name}</span>
                <span className="mt-0.5 block tabular text-caption text-ink-secondary">
                  {formatBRL(cycle === "yearly" ? p.yearlyPriceCents : p.monthlyPriceCents)}
                  {cycle === "yearly" ? " por ano" : " por mês"}
                </span>
                {p.description ? (
                  <span className="mt-1 block text-meta leading-4 text-ink-tertiary">
                    {p.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <Card className="mt-3 space-y-4 px-5 py-4">
          <Field label="Ciclo de cobrança" htmlFor="cycle">
            <Select
              id="cycle"
              value={cycle}
              onChange={(e) => setCycle(e.target.value as "monthly" | "yearly")}
            >
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
            </Select>
          </Field>

          <Field
            label="Como a conta começa"
            htmlFor="start"
            hint={
              start === "trial"
                ? `Entra em teste por ${plano?.trialDays ?? 14} dias e não conta como receita até converter.`
                : "Entra pagando: a assinatura já soma no MRR de hoje."
            }
          >
            <Select
              id="start"
              value={start}
              onChange={(e) => setStart(e.target.value as "trial" | "active")}
            >
              <option value="trial">Período de teste</option>
              <option value="active">Assinatura ativa</option>
            </Select>
          </Field>

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-caption text-ink-secondary">
              {start === "trial" ? "Valor após o teste" : "Valor cobrado"}
            </span>
            <span className="tabular text-entity text-ink">
              {formatBRL(preco)}
              <span className="ml-1 text-caption font-normal text-ink-secondary">
                {cycle === "yearly" ? "por ano" : "por mês"}
              </span>
            </span>
          </div>
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="md" loading={pending}>
          Cadastrar conta
        </Button>
        <Link
          href="/admin/contas"
          className="flex items-center gap-1.5 text-label text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          Cancelar
        </Link>
      </div>
    </form>
  );
}
