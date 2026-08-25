import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { listGroupInbox } from "@/server/services/group-inbox-service";
import { getConnection } from "@/server/services/whatsapp-connection-service";
import { GruposView } from "./grupos-view";

export const metadata = { title: "Grupos" };
export const dynamic = "force-dynamic";

export default async function GruposPage() {
  const ctx = await requireSession();
  if (ctx.role === "professional") redirect("/hoje");

  const connection = await getConnection(ctx);
  const connected = connection?.status === "connected";

  /**
   * A primeira página vem pronta do servidor.
   *
   * Antes ela era buscada pelo navegador depois de montar, porque a lista
   * dependia de uma chamada à uazapi e prender a navegação nisso fazia a tela
   * parecer travada. Agora ela sai do banco em centenas de milissegundos, e
   * buscar do cliente só adicionaria uma ida e volta e um esqueleto piscando
   * antes do conteúdo que já estava pronto aqui.
   */
  const inicial = connected ? await listGroupInbox(ctx, { limit: 30, offset: 0, classification: "all" }) : null;

  return <GruposView connected={connected} canManage={ctx.role !== "staff"} inicial={inicial} />;
}
