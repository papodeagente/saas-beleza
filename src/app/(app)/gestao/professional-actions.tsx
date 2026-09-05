"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { deleteProfessionalAction, updateProfessionalAction, type CadastroResult } from "./actions";

type Option = { id: number; name: string };

export type ProfessionalRow = {
  id: number;
  name: string;
  specialty: string | null;
  color: string;
  commissionBps: number;
  active: boolean;
  serviceIds: number[];
};

function Checks({
  options,
  values,
  onChange,
}: {
  options: Option[];
  values: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.id}
          className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-label text-ink"
        >
          <input
            type="checkbox"
            checked={values.includes(option.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, option.id]
                  : values.filter((id) => id !== option.id),
              )
            }
            className="size-4 accent-[var(--color-accent)]"
          />
          {option.name}
        </label>
      ))}
    </div>
  );
}

/** Botões de editar/excluir de uma linha de profissional, com os painéis das duas ações. */
export function ProfessionalActions({
  professional,
  services,
}: {
  professional: ProfessionalRow;
  services: Option[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<CadastroResult | null>(null);

  const [name, setName] = useState(professional.name);
  const [specialty, setSpecialty] = useState(professional.specialty ?? "");
  const [color, setColor] = useState(professional.color);
  const [commissionPct, setCommission] = useState(professional.commissionBps / 100);
  const [active, setActive] = useState(professional.active);
  const [serviceIds, setServiceIds] = useState<number[]>(professional.serviceIds);

  function closeAll() {
    setMode("closed");
    setConfirming(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateProfessionalAction({
        id: professional.id,
        name,
        specialty,
        color,
        commissionPct,
        active,
        serviceIds,
      });
      if (result.ok) {
        toast.success("Profissional atualizado");
        router.refresh();
        closeAll();
      } else {
        setError(result);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteProfessionalAction({ id: professional.id });
      if (result.ok) {
        toast.success(result.deactivated ? result.reason : `${professional.name} foi excluído(a)`);
        router.refresh();
        closeAll();
      } else {
        toast.error(result.error);
        closeAll();
      }
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Editar ${professional.name}`}
        onClick={() => setMode("edit")}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Excluir ${professional.name}`}
        onClick={() => setMode("delete")}
      >
        <Trash2 />
      </Button>

      {mode === "edit" ? (
        <Sheet open onOpenChange={(v) => !v && closeAll()}>
          <SheetContent
            title="Editar profissional"
            description={professional.name}
            footer={
              <>
                <Button variant="ghost" onClick={closeAll}>
                  Cancelar
                </Button>
                <Button variant="primary" loading={pending} disabled={!name.trim()} onClick={save}>
                  Salvar alterações
                </Button>
              </>
            }
          >
            <div className="space-y-4 px-5 py-4">
              <Field label="Nome" htmlFor="edit-professional-name">
                <Input
                  id="edit-professional-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Especialidade" htmlFor="edit-professional-specialty" optional>
                <Input
                  id="edit-professional-specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  placeholder="Ex.: Nail designer"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Comissão (%)" htmlFor="edit-professional-commission">
                  <Input
                    id="edit-professional-commission"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={commissionPct}
                    onChange={(e) => setCommission(Number(e.target.value))}
                  />
                </Field>
                <Field label="Cor na agenda" htmlFor="edit-professional-color">
                  <Input
                    id="edit-professional-color"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Status" htmlFor="edit-professional-active">
                <Select
                  id="edit-professional-active"
                  value={active ? "1" : "0"}
                  onChange={(e) => setActive(e.target.value === "1")}
                >
                  <option value="1">Ativo</option>
                  <option value="0">Inativo</option>
                </Select>
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-label text-ink">Serviços que realiza</legend>
                {services.length ? (
                  <Checks options={services} values={serviceIds} onChange={setServiceIds} />
                ) : (
                  <p className="text-caption text-ink-secondary">Nenhum serviço cadastrado.</p>
                )}
              </fieldset>
              <p className="text-caption text-ink-tertiary">
                Jornada e unidade continuam em Agenda › Disponibilidade.
              </p>
              {error && !error.ok ? (
                <p role="alert" className="text-caption text-danger">
                  {error.error}
                </p>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {mode === "delete" ? (
        <Sheet open onOpenChange={(v) => !v && closeAll()}>
          <SheetContent title="Excluir profissional" description={professional.name}>
            <div className="space-y-3 px-5 py-4">
              <p className="text-body text-ink-secondary">
                Se {professional.name} já tiver atendimentos ou comissões registradas, o cadastro será{" "}
                <strong className="text-ink">desativado</strong> em vez de excluído, para preservar o
                histórico da agenda e do financeiro. Sem histórico, a exclusão é definitiva.
              </p>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="danger" size="md" loading={pending} onClick={remove}>
                    Confirmar
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
                    Voltar
                  </Button>
                </div>
              ) : (
                <Button variant="danger" size="md" onClick={() => setConfirming(true)}>
                  Excluir profissional
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
