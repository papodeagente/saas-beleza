"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, CheckCircle2, Copy, Link2, RefreshCw, RotateCcw, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";
import {
  disconnectAction,
  refreshStatusAction,
  rotateWebhookAction,
  saveConnectionAction,
} from "./actions";

type ConnectionData = {
  id: number;
  name: string;
  baseUrl: string;
  tokenPreview: string;
  instanceName: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  statusDetail: string | null;
  webhookUrl: string;
  webhookSeenAt: string | null;
  lastCheckedAt: string | null;
  connectedAt: string | null;
};

const STATUS: Record<ConnectionData["status"], { label: string; tone: "positive" | "attention" | "danger" | "neutral" }> = {
  connected: { label: "Conectado", tone: "positive" },
  connecting: { label: "Conectando", tone: "attention" },
  disconnected: { label: "Desconectado", tone: "attention" },
  error: { label: "Com erro", tone: "danger" },
};

/**
 * Conexão manual com a uazapi.
 *
 * O fluxo é deliberadamente de duas mãos: aqui você informa onde a instância
 * está e qual é o token dela; lá no painel da uazapi você aponta o webhook
 * para a URL que esta tela mostra. Nada é provisionado automaticamente, então
 * a instância continua sendo sua e nenhuma credencial de administração passa
 * por este sistema.
 */
export function WhatsappView({
  connection,
  appUrlConfigured,
}: {
  connection: ConnectionData | null;
  appUrlConfigured: boolean;
}) {
  const [current, setCurrent] = useState<ConnectionData | null>(connection);
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [name, setName] = useState(connection?.name ?? "WhatsApp");
  const [saving, startSaving] = useTransition();
  const [refreshing, startRefreshing] = useTransition();
  const [rotating, startRotating] = useTransition();
  const [copied, setCopied] = useState(false);

  // A confirmação no próprio botão volta ao normal sozinha.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const status = current ? STATUS[current.status] : null;

  function save() {
    startSaving(async () => {
      const result = await saveConnectionAction({ baseUrl, instanceToken: token || undefined, name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent(serialize(result.connection));
      setToken("");
      toast.success(
        result.connection.status === "connected"
          ? "Conectado. Agora configure o webhook na uazapi."
          : "Dados salvos. A instância respondeu, mas não está conectada ao WhatsApp.",
      );
    });
  }

  function refresh() {
    startRefreshing(async () => {
      const result = await refreshStatusAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent(serialize(result.connection));
    });
  }

  function rotate() {
    startRotating(async () => {
      const result = await rotateWebhookAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent(serialize(result.connection));
      toast.success("Nova URL gerada. Atualize o webhook na uazapi.");
    });
  }

  async function copyWebhook() {
    if (!current) return;
    const ok = await copyToClipboard(current.webhookUrl);
    if (!ok) {
      toast.error("Não consegui copiar. Toque no endereço para selecionar e copie manualmente.");
      return;
    }
    setCopied(true);
    toast.success("URL copiada");
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-title text-ink">WhatsApp</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Conecte a instância da uazapi que você já usa. Os dados são seus: informe onde ela está e qual é o token,
          e aponte o webhook dela para o endereço que aparece abaixo.
        </p>
      </header>

      <Card className="mb-4">
        <CardHeader
          title="Instância"
          action={
            status ? (
              <Badge tone={status.tone}>
                {current?.status === "connected" ? <CheckCircle2 className="size-3" aria-hidden /> : null}
                {status.label}
              </Badge>
            ) : null
          }
        />
        <div className="flex flex-col gap-3 p-4 pt-0">
          <Field label="URL do servidor" hint="Exemplo: https://sua-instancia.uazapi.com">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" autoComplete="off" />
          </Field>

          <Field
            label="Token da instância"
            hint={
              current
                ? `Token salvo: ${current.tokenPreview}. Deixe em branco para manter.`
                : "O token da instância, não o token de administração da uazapi."
            }
          >
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={current ? "•••• manter o atual" : "Cole o token"}
              autoComplete="off"
              type="password"
            />
          </Field>

          <Field label="Nome interno" hint="Só para você identificar esta conexão.">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>

          {current && current.status === "error" && current.statusDetail ? (
            <p className="flex items-start gap-1.5 rounded-control bg-danger-soft px-2.5 py-2 text-caption text-danger">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {current.statusDetail}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="md" onClick={save} loading={saving} disabled={!baseUrl.trim() || (!current && !token.trim())}>
              {current ? "Salvar e testar" : "Conectar"}
            </Button>
            {current ? (
              <>
                <Button variant="secondary" size="md" onClick={refresh} loading={refreshing}>
                  <RefreshCw aria-hidden />
                  Verificar agora
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={async () => {
                    if (!confirm("Desconectar esta instância do sistema? A instância na uazapi continua no ar.")) return;
                    const result = await disconnectAction();
                    if (result.ok) {
                      setCurrent(null);
                      toast.success("Conexão removida do sistema.");
                    } else {
                      toast.error(result.error ?? "Não foi possível desconectar.");
                    }
                  }}
                >
                  <Unplug aria-hidden />
                  Desconectar
                </Button>
              </>
            ) : null}
          </div>

          {current ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-caption">
              <Row label="Número" value={current.phoneNumber ?? "—"} />
              <Row label="Perfil" value={current.profileName ?? "—"} />
              <Row label="Instância" value={current.instanceName ?? "—"} />
              <Row
                label="Última verificação"
                value={current.lastCheckedAt ? format(new Date(current.lastCheckedAt), "dd/MM HH:mm", { locale: ptBR }) : "—"}
              />
            </dl>
          ) : null}
        </div>
      </Card>

      {current ? (
        <Card>
          <CardHeader title="Webhook" />
          <div className="flex flex-col gap-3 p-4 pt-0">
            <p className="text-body text-ink-secondary">
              No painel da uazapi, abra a instância, vá em webhook e cole este endereço. É por ele que as mensagens
              chegam ao sistema.
            </p>

            <div className="flex items-center gap-2 rounded-control bg-surface-sunken px-3 py-2">
              <Link2 className="size-4 shrink-0 text-ink-tertiary" aria-hidden />
              <input
                readOnly
                value={current.webhookUrl}
                aria-label="URL do webhook"
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 truncate bg-transparent text-caption text-ink outline-none"
              />
              <Button variant="ghost" size="sm" onClick={copyWebhook} className="shrink-0">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>

            {!appUrlConfigured ? (
              <p className="flex items-start gap-1.5 rounded-control bg-attention-soft px-2.5 py-2 text-caption text-attention">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                O endereço acima veio do navegador. Defina APP_URL no servidor para garantir que ele seja sempre o
                endereço público correto.
              </p>
            ) : null}

            <div className="text-caption text-ink-secondary">
              <p className="mb-1 font-medium text-ink">Marque estes eventos na uazapi:</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>mensagens (messages), para receber o que o cliente escreve</li>
                <li>status das mensagens (messages_update), para os confirmados de entrega e leitura</li>
                <li>conexão (connection), para saber quando o aparelho cai</li>
              </ul>
            </div>

            <p className="flex items-center gap-1.5 text-caption">
              {current.webhookSeenAt ? (
                <>
                  <CheckCircle2 className="size-3.5 shrink-0 text-positive" aria-hidden />
                  <span className="text-positive">
                    Webhook funcionando. Último evento recebido{" "}
                    {format(new Date(current.webhookSeenAt), "dd/MM 'às' HH:mm", { locale: ptBR })}.
                  </span>
                </>
              ) : (
                <>
                  <TriangleAlert className="size-3.5 shrink-0 text-attention" aria-hidden />
                  <span className="text-attention">
                    Ainda não recebemos nenhum evento. Mande uma mensagem de teste para o número depois de salvar o
                    webhook.
                  </span>
                </>
              )}
            </p>

            <button
              type="button"
              onClick={rotate}
              disabled={rotating}
              className="flex items-center gap-1.5 self-start text-caption text-ink-secondary hover:text-ink"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Gerar nova URL (a antiga para de funcionar na hora)
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </>
  );
}

function serialize(connection: {
  id: number;
  name: string;
  baseUrl: string;
  tokenPreview: string;
  instanceName: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  status: ConnectionData["status"];
  statusDetail: string | null;
  webhookUrl: string;
  webhookSeenAt: Date | null;
  lastCheckedAt: Date | null;
  connectedAt: Date | null;
}): ConnectionData {
  return {
    ...connection,
    webhookUrl: connection.webhookUrl.startsWith("http")
      ? connection.webhookUrl
      : `${window.location.origin}${connection.webhookUrl}`,
    webhookSeenAt: connection.webhookSeenAt?.toISOString() ?? null,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
  };
}
