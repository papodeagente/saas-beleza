import { CheckCircle2, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

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
  disconnected: { label: "Instância criada, aparelho não pareado", tone: "attention" },
  error: { label: "Com erro", tone: "danger" },
};

/**
 * O WhatsApp da conta, só para olhar.
 *
 * Aqui já houve um formulário: o administrador colava URL e token da instância
 * pela cliente. Ele existia porque a instância era dela e alguém precisava
 * fazer a parte técnica. Não é mais: a plataforma cria a instância sozinha, e a
 * cliente resolve tudo em `/whatsapp` escaneando o QR code.
 *
 * O que sobra nesta tela é o que o suporte precisa saber ao atender um
 * chamado — se o aparelho está no ar, qual número está pareado e desde quando
 * o servidor não consegue falar com ele.
 */
export function WhatsappConnectPanel({ conexao }: { organizationId: number; conexao: ConexaoAtual }) {
  const status = conexao ? STATUS[conexao.status] : null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 className="flex items-center gap-2 text-section">
          <MessageCircle className="size-4 text-ink-tertiary" aria-hidden />
          WhatsApp
        </h2>
        {status ? (
          <Badge tone={status.tone}>
            {conexao?.status === "connected" ? <CheckCircle2 className="size-3" aria-hidden /> : null}
            {status.label}
          </Badge>
        ) : (
          <Badge tone="neutral">Sem conexão</Badge>
        )}
      </div>

      <div className="px-5 pb-4">
        {conexao ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
            <dt className="text-ink-secondary">Número</dt>
            <dd className="text-right text-ink">{conexao.phoneNumber ?? "—"}</dd>
            <dt className="text-ink-secondary">Perfil</dt>
            <dd className="text-right text-ink">{conexao.profileName ?? "—"}</dd>
            {conexao.status === "error" && conexao.statusDetail ? (
              <>
                <dt className="text-ink-secondary">Erro</dt>
                <dd className="text-right text-danger">{conexao.statusDetail}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-body text-ink-secondary">
            Esta conta ainda não conectou nenhum aparelho. Quem conecta é a própria cliente, em WhatsApp, num
            clique: o sistema cria a instância e mostra o QR code para ela escanear.
          </p>
        )}
      </div>
    </Card>
  );
}
