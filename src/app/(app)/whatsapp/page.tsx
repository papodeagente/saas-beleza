import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { getConnection, publicBaseUrl } from "@/server/services/whatsapp-connection-service";
import { WhatsappView } from "./whatsapp-view";

export const metadata = { title: "WhatsApp — Lumina" };
export const dynamic = "force-dynamic";

export default async function WhatsappPage() {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");

  const connection = await getConnection(ctx);

  // A URL do webhook precisa ser a que o mundo externo enxerga. Quando APP_URL
  // não está definida, o host do próprio pedido é a melhor aproximação — e é
  // o que a pessoa vai copiar para o painel da uazapi.
  const configured = publicBaseUrl();
  let origin = configured;
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http";
    origin = host ? `${proto}://${host}` : "";
  }

  return (
    <WhatsappView
      connection={
        connection
          ? {
              ...connection,
              // A URL guardada usa APP_URL; se ela não existe, completa com a origem atual.
              webhookUrl: connection.webhookUrl.startsWith("http")
                ? connection.webhookUrl
                : `${origin}${connection.webhookUrl}`,
              webhookSeenAt: connection.webhookSeenAt?.toISOString() ?? null,
              lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
              connectedAt: connection.connectedAt?.toISOString() ?? null,
            }
          : null
      }
      appUrlConfigured={Boolean(configured)}
    />
  );
}
