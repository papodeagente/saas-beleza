"use client";

import { CheckCircle2, QrCode, RefreshCw, Smartphone, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useFuso } from "@/lib/fuso";
import { formatTz } from "@/lib/tz";
import {
  conectarWhatsappAction,
  disconnectAction,
  disconnectDeviceAction,
  refreshStatusAction,
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
  gerenciadaPelaPlataforma: boolean;
};

const STATUS: Record<ConnectionData["status"], { label: string; tone: "positive" | "attention" | "danger" | "neutral" }> = {
  connected: { label: "Conectado", tone: "positive" },
  connecting: { label: "Conectando", tone: "attention" },
  disconnected: { label: "Desconectado", tone: "attention" },
  error: { label: "Com erro", tone: "danger" },
};

/**
 * Conectar o WhatsApp da conta.
 *
 * Com servidor próprio (`provisionamento`), a tela tem UM botão: o sistema cria
 * a instância, aponta o webhook e mostra o QR. A cliente não vê URL, token nem
 * endereço de webhook — são dados internos, e pedir que ela os administre era
 * transformar um passo de dois minutos numa consulta ao suporte.
 *
 * Sem servidor próprio, cai no modelo antigo: a instância é do cliente e ele
 * informa onde ela está. É o que continua valendo para quem já estava assim.
 */
export function WhatsappView({
  connection,
  appUrlConfigured,
  provisionamento,
}: {
  connection: ConnectionData | null;
  appUrlConfigured: boolean;
  /** Existe servidor de WhatsApp da plataforma para criar a instância. */
  provisionamento: boolean;
}) {
  const fuso = useFuso();
  const [current, setCurrent] = useState<ConnectionData | null>(connection);
  const [refreshing, startRefreshing] = useTransition();
  const [conectando, startConectando] = useTransition();

  const status = current ? STATUS[current.status] : null;

  /**
   * Conexão herdada do tempo em que a instância era do cliente.
   *
   * Ela continua recebendo mensagem enquanto estiver ativa — não se derruba o
   * atendimento de ninguém para arrumar uma tela. O que a tela faz é oferecer a
   * troca, e dizer o que ela custa: parear o número de novo.
   */
  const herdada = Boolean(current && !current.gerenciadaPelaPlataforma);

  function conectar() {
    startConectando(async () => {
      const result = await conectarWhatsappAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent(serialize(result.connection));
      toast.success("Tudo pronto. Escaneie o código com o celular.");
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

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-title text-ink">WhatsApp</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Escaneie o código com o celular que atende a clientela. É o mesmo gesto do WhatsApp Web, e leva menos de
          um minuto.
        </p>
      </header>

      {!provisionamento ? (
        <Card className="mb-4">
          <CardHeader title="Indisponível" />
          <p className="px-4 pb-4 text-body text-ink-secondary">
            A conexão com o WhatsApp não está configurada neste ambiente. Fale com o suporte.
          </p>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader
            title="Aparelho"
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
            {current ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
                  <Row label="Número" value={current.phoneNumber ?? "—"} />
                  <Row label="Perfil" value={current.profileName ?? "—"} />
                  <Row
                    label="Conectado desde"
                    value={current.connectedAt ? formatTz(new Date(current.connectedAt), fuso, "dd/MM HH:mm") : "—"}
                  />
                  <Row
                    label="Última verificação"
                    value={current.lastCheckedAt ? formatTz(new Date(current.lastCheckedAt), fuso, "dd/MM HH:mm") : "—"}
                  />
                </dl>

                {herdada ? (
                  <div className="rounded-control bg-attention-soft px-3 py-2.5">
                    <p className="text-caption text-attention">
                      Este número está ligado por um servidor antigo, de fora da plataforma. Conectar pelo nosso
                      servidor deixa tudo automático — você só vai precisar escanear o código de novo, no mesmo
                      celular.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={conectar}
                      loading={conectando}
                    >
                      <QrCode aria-hidden />
                      Conectar pelo nosso servidor
                    </Button>
                  </div>
                ) : null}

                {current.status === "error" && current.statusDetail ? (
                  <p className="flex items-start gap-1.5 rounded-control bg-danger-soft px-2.5 py-2 text-caption text-danger">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {current.statusDetail}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button variant="secondary" size="md" onClick={refresh} loading={refreshing}>
                    <RefreshCw aria-hidden />
                    Verificar agora
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={async () => {
                      if (
                        !confirm(
                          "Desconectar este WhatsApp? As conversas continuam guardadas, mas o sistema para de enviar e receber mensagens até você conectar de novo.",
                        )
                      )
                        return;
                      const result = await disconnectAction();
                      if (result.ok) {
                        setCurrent(null);
                        toast.success("WhatsApp desconectado.");
                      } else {
                        toast.error(result.error ?? "Não foi possível desconectar.");
                      }
                    }}
                  >
                    <Unplug aria-hidden />
                    Desconectar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-body text-ink-secondary">
                  Um número por conta. Use o celular da recepção, não o pessoal: quem conectar vai ter as conversas
                  das clientes aparecendo aqui dentro.
                </p>
                {!appUrlConfigured ? (
                  <p className="flex items-start gap-1.5 rounded-control bg-attention-soft px-2.5 py-2 text-caption text-attention">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Falta o endereço público do sistema. Sem ele o WhatsApp conecta e as mensagens não chegam.
                  </p>
                ) : null}
                <div>
                  <Button variant="primary" size="md" onClick={conectar} loading={conectando}>
                    <QrCode aria-hidden />
                    Conectar meu WhatsApp
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {current ? <PairingCard connection={current} onChange={setCurrent} /> : null}
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
  gerenciadaPelaPlataforma: boolean;
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
  /**
   * Já existe QR esperando? Então a tela abre NELE.
   *
   * Pedir "clique aqui para ver o código" logo depois de a pessoa ter clicado
   * em conectar é cobrar um clique para mostrar o que ela acabou de pedir — e
   * o código tem validade, então cada segundo parado é um QR mais perto de
   * expirar. Vale também para quem recarrega a página no meio do pareamento.
   */
  const [mode, setMode] = useState<"idle" | "qr" | "code">(
    connection.pairingQrCode && connection.status !== "connected" ? "qr" : "idle",
  );
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
              <Button variant="primary" size="md" onClick={() => begin("qr")} loading={starting}>
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
              <Button variant="primary"
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
