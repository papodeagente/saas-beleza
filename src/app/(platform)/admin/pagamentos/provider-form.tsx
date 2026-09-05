"use client";

import { Check, Copy, KeyRound, Link2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { copyToClipboard } from "@/lib/clipboard";
import { deleteProviderAction, saveProviderAction } from "./actions";

export type ProviderSummary = {
  id: number;
  kind: string;
  name: string;
  enabled: boolean;
  hasWebhookToken: boolean;
  webhookTokenHint: string | null;
  /** Provedores sem webhook implementado não pedem token para poder ligar. */
  usesWebhook: boolean;
};

export type KindOption = { value: string; label: string; usesWebhook: boolean };

/**
 * Cadastro e edição de provedor.
 *
 * O token é o único campo que não volta preenchido: o banco só tem o hash dele.
 * Deixar em branco mantém o que está guardado — dito na tela, porque um campo
 * de senha vazio num formulário de edição costuma ser lido como "vai apagar".
 */
export function ProviderEditor({
  provider,
  kindOptions,
  label,
  variant = "secondary",
}: {
  provider?: ProviderSummary;
  kindOptions: KindOption[];
  label: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const editing = Boolean(provider);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(provider?.kind ?? kindOptions[0]?.value ?? "");
  const [name, setName] = useState(provider?.name ?? kindOptions[0]?.label ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? false);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const usesWebhook = editing
    ? (provider?.usesWebhook ?? false)
    : (kindOptions.find((option) => option.value === kind)?.usesWebhook ?? false);
  const willHaveToken = clearToken ? false : Boolean(token.trim()) || Boolean(provider?.hasWebhookToken);
  const blocked = enabled && usesWebhook && !willHaveToken;

  function reset() {
    setKind(provider?.kind ?? kindOptions[0]?.value ?? "");
    setName(provider?.name ?? kindOptions[0]?.label ?? "");
    setEnabled(provider?.enabled ?? false);
    setToken("");
    setClearToken(false);
    setConfirmingDelete(false);
  }

  function remove() {
    if (!provider) return;
    startDeleting(async () => {
      const result = await deleteProviderAction(provider.id);
      if (!result.ok) {
        toast.error(result.error);
        setConfirmingDelete(false);
        return;
      }
      toast.success(`${provider.name} excluído.`);
      setOpen(false);
      router.refresh();
    });
  }

  function submit() {
    startSaving(async () => {
      const result = await saveProviderAction({
        kind,
        name,
        enabled,
        webhookToken: clearToken ? undefined : token.trim() || undefined,
        clearWebhookToken: clearToken,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Provedor atualizado." : "Provedor cadastrado.");
      setOpen(false);
      setToken("");
      setClearToken(false);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button variant={variant} size="sm">
          {editing ? null : <Plus aria-hidden />}
          {label}
        </Button>
      </SheetTrigger>

      <SheetContent
        title={editing ? `Editar ${provider?.name}` : "Novo provedor"}
        description={
          editing
            ? usesWebhook
              ? "O token só é substituído se você digitar um novo."
              : undefined
            : usesWebhook
              ? "Cole o token que o provedor usa para autenticar as entregas do webhook."
              : "Este provedor ainda não recebe webhook: serve para marcar de onde vem a cobrança."
        }
        footer={
          <>
            {editing ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-danger hover:text-danger"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden />
                Excluir
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={submit} loading={saving} disabled={blocked}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-5 py-4">
          {confirmingDelete && provider ? (
            <div className="space-y-3 rounded-card border border-danger/25 bg-danger-soft px-3 py-3">
              <p className="flex items-start gap-1.5 text-caption text-danger">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Excluir {provider.name}? Só é possível quando ele nunca recebeu evento nem cobrança —
                se já tiver histórico, a exclusão é recusada e o jeito é desligar.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="danger" size="sm" onClick={remove} loading={deleting}>
                  Confirmar exclusão
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Voltar
                </Button>
              </div>
            </div>
          ) : null}

          {editing ? null : (
            <Field label="Provedor" htmlFor="provider-kind">
              <Select
                id="provider-kind"
                value={kind}
                onChange={(event) => {
                  const next = event.target.value;
                  setKind(next);
                  const option = kindOptions.find((item) => item.value === next);
                  if (option) setName(option.label);
                }}
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Nome"
            htmlFor="provider-name"
            hint="Como este provedor aparece nas telas da plataforma."
          >
            <Input
              id="provider-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Estado" htmlFor="provider-enabled">
            <Select
              id="provider-enabled"
              value={enabled ? "on" : "off"}
              onChange={(event) => setEnabled(event.target.value === "on")}
            >
              <option value="on">Ligado — recebe e registra eventos</option>
              <option value="off">Desligado — recusa toda entrega</option>
            </Select>
          </Field>

          {usesWebhook ? (
            <Field
              label="Token do webhook"
              htmlFor="provider-token"
              optional={provider?.hasWebhookToken}
              hint={
                provider?.hasWebhookToken
                  ? `Guardado como ${provider.webhookTokenHint ?? "••••"}. Em branco, continua o mesmo.`
                  : "É o hottok do painel da Hotmart. Guardamos só o hash dele."
              }
            >
              <Input
                id="provider-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                disabled={clearToken}
                placeholder={provider?.hasWebhookToken ? "••••••••" : "cole o token aqui"}
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
          ) : null}

          {usesWebhook && provider?.hasWebhookToken ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setClearToken((value) => !value);
                setToken("");
              }}
            >
              <KeyRound aria-hidden />
              {clearToken ? "Manter o token guardado" : "Apagar o token guardado"}
            </Button>
          ) : null}

          {blocked ? (
            <p className="flex items-start gap-1.5 rounded-control bg-attention-soft px-2.5 py-2 text-caption text-attention">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Ligar sem token não adianta: sem ele toda entrega é recusada com 401. Cole o token ou
              deixe o provedor desligado.
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * O endereço que vai colado no painel da Hotmart.
 *
 * Fica selecionável mesmo quando a cópia falha — em HTTP puro o clipboard do
 * navegador não existe, e um botão que não copia sem avisar é pior que nenhum.
 */
export function WebhookUrlBox({ url, appUrlConfigured }: { url: string; appUrlConfigured: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyToClipboard(url);
    if (!ok) {
      toast.error("Não consegui copiar. Selecione o endereço e copie à mão.");
      return;
    }
    setCopied(true);
    toast.success("Endereço copiado.");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-2">
        <Link2 className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
        <input
          readOnly
          value={url}
          aria-label="Endereço do webhook da Hotmart"
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-caption text-ink outline-none"
        />
        <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>

      {!appUrlConfigured ? (
        <p className="flex items-start gap-1.5 text-caption text-attention">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Este endereço veio do navegador. Defina APP_URL no servidor para garantir que ele seja
          sempre o endereço público.
        </p>
      ) : null}
    </div>
  );
}
