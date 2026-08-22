import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { getConnection } from "@/server/services/whatsapp-connection-service";
import { GruposView } from "./grupos-view";

export const metadata = { title: "Grupos — Lumina" };
export const dynamic = "force-dynamic";

export default async function GruposPage() {
  const ctx = await requireSession();
  if (ctx.role === "professional") redirect("/hoje");

  const connection = await getConnection(ctx);

  // A lista não é carregada aqui de propósito: com centenas de grupos a
  // chamada à uazapi leva segundos, e prender a navegação nisso faz a tela
  // parecer travada. O cliente busca assim que monta, já mostrando o esqueleto.
  return <GruposView connected={connection?.status === "connected"} canManage={ctx.role !== "staff"} />;
}
