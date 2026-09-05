"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/phone";
import { saveCustomerAction } from "./actions";

export type CustomerFormValues = {
  id?: number;
  name: string;
  phone: string;
  email: string;
  birthdate: string;
  notes: string;
  preferredProfessionalId: number | null;
  preferredBranchId: number | null;
  consentMarketing: boolean;
};

export type CustomerFormOptions = {
  professionals: Array<{ id: number; name: string }>;
  branches: Array<{ id: number; name: string }>;
};

const EMPTY: CustomerFormValues = {
  name: "",
  phone: "",
  email: "",
  birthdate: "",
  notes: "",
  preferredProfessionalId: null,
  preferredBranchId: null,
  consentMarketing: false,
};

export function CustomerForm({
  initial,
  options,
  onClose,
  onSaved,
}: {
  initial?: Partial<CustomerFormValues>;
  options: CustomerFormOptions;
  onClose: () => void;
  onSaved?: (customerId: number) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerFormValues>({ ...EMPTY, ...initial });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = Boolean(initial?.id);
  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveCustomerAction(
        {
          name: values.name,
          phone: values.phone,
          email: values.email,
          birthdate: values.birthdate,
          notes: values.notes,
          preferredProfessionalId: values.preferredProfessionalId,
          preferredBranchId: values.preferredBranchId,
          consentMarketing: values.consentMarketing,
        },
        initial?.id,
      );
      if (result.ok) {
        toast.success(editing ? "Cliente atualizado" : `${values.name.trim()} foi cadastrada`);
        router.refresh();
        onSaved?.(result.customerId);
        onClose();
      } else {
        setError({ message: result.error, field: result.field });
      }
    });
  }

  const fieldError = (name: string) =>
    error?.field === name ? error.message : undefined;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={editing ? "Editar cliente" : "Novo cliente"}
        description={
          editing ? "As alterações valem para todo o histórico." : "Só o nome é obrigatório."
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={pending}
              disabled={values.name.trim().length < 2}
              onClick={submit}
            >
              {editing ? "Salvar alterações" : "Cadastrar cliente"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          <Field label="Nome" htmlFor="c-nome" error={fieldError("name")}>
            <Input
              id="c-nome"
              autoFocus
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Nome e sobrenome"
              aria-invalid={fieldError("name") ? true : undefined}
              aria-describedby={fieldError("name") ? "c-nome-desc" : undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Celular"
              htmlFor="c-fone"
              error={fieldError("phone")}
              hint={values.phone ? formatPhone(values.phone) : "Com DDD"}
            >
              <Input
                id="c-fone"
                inputMode="tel"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="84 99999-0000"
                aria-invalid={fieldError("phone") ? true : undefined}
                aria-describedby="c-fone-desc"
              />
            </Field>

            <Field label="Nascimento" htmlFor="c-nasc" optional error={fieldError("birthdate")}>
              <Input
                id="c-nasc"
                type="date"
                value={values.birthdate}
                onChange={(e) => set("birthdate", e.target.value)}
              />
            </Field>
          </div>

          <Field label="E-mail" htmlFor="c-email" optional error={fieldError("email")}>
            <Input
              id="c-email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="cliente@email.com"
              aria-invalid={fieldError("email") ? true : undefined}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Profissional preferido" htmlFor="c-prof" optional>
              <Select
                id="c-prof"
                value={values.preferredProfessionalId ?? ""}
                onChange={(e) =>
                  set("preferredProfessionalId", e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Sem preferência</option>
                {options.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Unidade preferida" htmlFor="c-uni" optional>
              <Select
                id="c-uni"
                value={values.preferredBranchId ?? ""}
                onChange={(e) =>
                  set("preferredBranchId", e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Sem preferência</option>
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* O campo clínico: é o que a profissional precisa ler antes de encostar na cliente */}
          <Field
            label="Antes de atender"
            htmlFor="c-obs"
            optional
            hint="Alergias, gestação, uso de ácido, contraindicações, preferências."
          >
            <Textarea
              id="c-obs"
              rows={4}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Ex.: alérgica a lidocaína; não pode laser no verão."
            />
          </Field>

          <label className="flex items-start gap-2.5 rounded-card border border-line bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              checked={values.consentMarketing}
              onChange={(e) => set("consentMarketing", e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block text-label text-ink">Autoriza contato de divulgação</span>
              <span className="mt-0.5 block text-caption text-ink-secondary">
                Marque apenas se a cliente autorizou receber novidades e promoções.
              </span>
            </span>
          </label>

          {error && !error.field ? (
            <p role="alert" className="text-caption text-danger">
              {error.message}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
