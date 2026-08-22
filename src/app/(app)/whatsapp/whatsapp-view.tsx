"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check,
  CheckCircle2,
  Copy,
  Link2,
  QrCode,
  RefreshCw,
  RotateCcw,
  Smartphone,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";
import {
  disconnectAction,
  disconnectDeviceAction,
  refreshStatusAction,
  rotateWebhookAction,
  saveConnectionAction,
  startPairingAction,
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
  pairingQrCode: string | null;
  pairingCode: string | null;
  pairingUpdatedAt: string | null;
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

      {current ? <PairingCard connection={current} onChange={setCurrent} /> : null}

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
  pairingQrCode: string | null;
  pairingCode: string | null;
  pairingUpdatedAt: Date | null;
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
    pairingUpdatedAt: connection.pairingUpdatedAt?.toISOString() ?? null,
    webhookSeenAt: connection.webhookSeenAt?.toISOString() ?? null,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
  };
}

/**
 * Pareamento do aparelho, sem sair do sistema.
 *
 * Duas rotinas rodam enquanto o cartão está aberto esperando leitura:
 *
 * - a cada poucos segundos o status é reconsultado na uazapi. Perguntar direto,
 *   em vez de esperar o webhook, é o que faz o pareamento funcionar da primeira
 *   vez: no primeiro acesso o webhook ainda nem foi configurado.
 * - a cada meio minuto um código novo é pedido, porque o QR expira. Quando o
 *   webhook já está de pé, a uazapi manda o código novo sozinha e ele chega
 *   pelo mesmo caminho.
 */
function PairingCard({
  connection,
  onChange,
}: {
  connection: ConnectionData;
  onChange: (next: ConnectionData) => void;
}) {
  const [mode, setMode] = useState<"idle" | "qr" | "code">("idle");
  const [phone, setPhone] = useState("");
  const [starting, startPairingTransition] = useTransition();
  const [disconnecting, startDisconnecting] = useTransition();
  const connected = connection.status === "connected";
  const waiting = mode !== "idle" && !connected;

  function begin(nextMode: "qr" | "code") {
    setMode(nextMode);
    startPairingTransition(async () => {
      const result = await startPairingAction(nextMode === "code" ? { phone } : {});
      if (!result.ok) {
        toast.error(result.error);
        setMode("idle");
        return;
      }
      onChange(serialize(result.connection));
      if (result.connection.status === "connected") {
        toast.success("Aparelho já está conectado.");
        setMode("idle");
      }
    });
  }

  useEffect(() => {
    if (!waiting) return;
    let ticks = 0;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      if (cancelled) return;
      ticks += 1;

      // Meio minuto: pede um código novo, porque o atual já expirou.
      if (ticks % 6 === 0) {
        const renewed = await startPairingAction(mode === "code" ? { phone } : {});
        if (!cancelled && renewed.ok) {
          onChange(serialize(renewed.connection));
          if (renewed.connection.status === "connected") {
            toast.success("Aparelho conectado.");
            setMode("idle");
            return;
          }
        }
        return;
      }

      // Nos demais ciclos, só confere se já pareou.
      const fresh = await refreshStatusAction();
      if (cancelled || !fresh.ok) return;
      onChange(serialize(fresh.connection));
      if (fresh.connection.status === "connected") {
        toast.success("Aparelho conectado.");
        setMode("idle");
      }
    }, 5000);

    // Cinco minutos parado é desistência: parar de consultar evita bater na
    // uazapi por uma aba esquecida aberta.
    const stop = window.setTimeout(() => {
      cancelled = true;
      window.clearInterval(timer);
      setMode("idle");
    }, 300_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [waiting, mode, phone, onChange]);

  if (connected) {
    return (
      <Card className="mb-4">
        <CardHeader
          title="Aparelho"
          action={
            <Badge tone="positive">
              <CheckCircle2 className="size-3" aria-hidden />
              Conectado
            </Badge>
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 pt-0">
          <p className="text-body text-ink-secondary">
            {connection.phoneNumber
              ? `Recebendo e enviando pelo número ${connection.phoneNumber}.`
              : "O WhatsApp está pareado e pronto para atender."}
          </p>
          <Button
            variant="ghost"
            size="md"
            loading={disconnecting}
            onClick={() => {
              if (!confirm("Desconectar o aparelho? Para voltar a receber mensagens será preciso parear de novo.")) return;
              startDisconnecting(async () => {
                const result = await disconnectDeviceAction();
                if (result.ok) {
                  onChange(serialize(result.connection));
                  toast.success("Aparelho desconectado.");
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            <Unplug aria-hidden />
            Desconectar aparelho
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader title="Conectar o aparelho" />
      <div className="flex flex-col gap-3 p-4 pt-0">
        {mode === "idle" ? (
          <>
            <p className="text-body text-ink-secondary">
              Pareie o celular que vai atender. Escaneie o código com a câmera ou receba um código para digitar, se a
              câmera não for uma opção.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="md" onClick={() => begin("qr")} loading={starting}>
                <QrCode aria-hidden />
                Gerar QR code
              </Button>
              <Button variant="secondary" size="md" onClick={() => setMode("code")}>
                <Smartphone aria-hidden />
                Usar código pelo número
              </Button>
            </div>
          </>
        ) : null}

        {mode === "qr" ? (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="flex size-[232px] shrink-0 items-center justify-center rounded-control border border-line bg-white p-2">
              {connection.pairingQrCode ? (
                <img
                  src={connection.pairingQrCode}
                  alt="QR code para conectar o WhatsApp"
                  className="size-full object-contain"
                />
              ) : (
                <span className="text-caption text-ink-secondary">Gerando código…</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-label text-ink">No celular que vai atender:</p>
              <ol className="mt-1 list-inside list-decimal space-y-0.5 text-caption text-ink-secondary">
                <li>Abra o WhatsApp</li>
                <li>Toque em Configurações e depois em Aparelhos conectados</li>
                <li>Toque em Conectar aparelho</li>
                <li>Aponte a câmera para este código</li>
              </ol>
              <p className="mt-3 flex items-center gap-1.5 text-caption text-ink-secondary">
                <RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden />
                Esperando a leitura. O código se renova sozinho enquanto esta tela estiver aberta.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => begin("qr")} loading={starting}>
                  Gerar novo código
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {mode === "code" ? (
          <div className="flex flex-col gap-3">
            <Field
              label="Número do celular que vai atender"
              hint="Com código do país e DDD, por exemplo 5511999998888."
            >
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="5511999998888"
                inputMode="numeric"
              />
            </Field>

            {connection.pairingCode ? (
              <div className="rounded-control bg-surface-sunken px-3 py-4 text-center">
                <p className="text-caption text-ink-secondary">Digite este código no celular</p>
                <p className="mt-1 text-title tabular tracking-[0.3em] text-ink">{connection.pairingCode}</p>
                <p className="mt-2 text-caption text-ink-secondary">
                  WhatsApp, Aparelhos conectados, Conectar aparelho, Conectar com número de telefone.
                </p>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                size="md"
                onClick={() => begin("code")}
                loading={starting}
                disabled={phone.replace(/\D/g, "").length < 12}
              >
                {connection.pairingCode ? "Gerar novo código" : "Gerar código"}
              </Button>
              <Button variant="ghost" size="md" onClick={() => setMode("idle")}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
