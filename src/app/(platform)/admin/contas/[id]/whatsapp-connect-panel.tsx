"use client";

import { CheckCircle2, MessageCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { adminConnectWhatsappAction } from "../actions";

export type ConexaoAtual = {
  status: "disconnected" | "connecting" | "connected" | "error";
  statusDetail: string | null;
  baseUrl: string;
  phoneNumber: string | null;
  profileName: string | null;
} | null;

const STATUS: Record<
  NonNullable<ConexaoAtual>["status"],
  { label: string; tone: "positive" | "attention" | "danger" | "neutral" }
> = {
  connected: { label: "Conectado", tone: "positive" },
  connecting: { label: "Aguardando o aparelho", tone: "attention" },
  disconnected: { label: "Instância ok, aparelho não pareado", tone: "attention" },
  error: { label: "Com erro", tone: "danger" },
};

/**
 * A parte técnica de conectar o WhatsApp, feita AQUI — pelo administrador da
 * plataforma, com o login dele, nunca com a senha da cliente — para que ela
 * só precise abrir `/whatsapp` na própria conta e escanear o QR code. A URL
 * e o token vêm da instância que você já criou (ou vai criar) na uazapi
 * pra esta cliente.
 */
export function WhatsappConnectPanel({
  organizationId,
  conexao,
}: {
  organizationId: number;
  conexao: ConexaoAtual;
}) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(conexao?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const status = conexao ? STATUS[conexao.status] : null;

  function conectar() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await adminConnectWhatsappAction({ organizationId, baseUrl, instanceToken: token });
      if (result.ok) {
        setSuccess(result.message);
        setToken("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-section">
          <MessageCircle className="size-4 text-ink-tertiary" aria-hidden />
          WhatsApp
        </h2>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </div>

      {conexao ? (
        <p className="mt-1 text-caption text-ink-secondary">
          {conexao.phoneNumber
            ? `Número pareado: ${conexao.phoneNumber}${conexao.profileName ? ` (${conexao.profileName})` : ""}.`
            : conexao.status === "error"
              ? conexao.statusDetail || "A instância respondeu com erro."
              : "A instância está ok — a cliente ainda não escaneou o QR code."}
        </p>
      ) : (
        <p className="mt-1 text-caption text-ink-secondary">
          Nenhuma instância conectada ainda. Crie uma na uazapi para esta cliente e cole os dados
          abaixo.
        </p>
      )}

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <Field label="URL do servidor" htmlFor="admin-wa-url" hint="A instância que você criou na uazapi para esta cliente.">
          <Input
            id="admin-wa-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://sua-instancia.uazapi.com"
            autoComplete="off"
          />
        </Field>
        <Field label="Token da instância" htmlFor="admin-wa-token">
          <Input
            id="admin-wa-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cole o token"
            autoComplete="off"
            type="password"
          />
        </Field>

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-control bg-danger-soft px-2.5 py-2 text-caption text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="flex items-start gap-1.5 rounded-control bg-positive-soft px-2.5 py-2 text-caption text-positive">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {success}
          </p>
        ) : null}

        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={!baseUrl.trim() || !token.trim()}
          onClick={conectar}
        >
          {conexao ? "Reconectar" : "Conectar"}
        </Button>
        <p className="text-meta text-ink-tertiary">
          Depois disso, a cliente entra na própria conta, abre WhatsApp e só precisa escanear o QR
          code — nenhum dado técnico chega até ela.
        </p>
      </div>
    </Card>
  );
}
