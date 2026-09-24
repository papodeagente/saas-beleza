import { and, avg, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { services } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { contaDaClinica, regraDeCobranca } from "@/server/services/asaas-account-service";
import { PagamentosView } from "./pagamentos-view";

export const metadata = { title: "Pagamentos" };
export const dynamic = "force-dynamic";

/** Preço de referência do exemplo quando a clínica ainda não cadastrou serviço. */
const EXEMPLO_PADRAO_CENTS = 12000;

export default async function PagamentosPage() {
  const ctx = await requireSession();
  // Quem recebe o dinheiro é a clínica: conectar conta bancária é assunto de
  // quem administra, não da recepção.
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");

  const [conta, regra, [media]] = await Promise.all([
    contaDaClinica(ctx.organizationId),
    regraDeCobranca(ctx.organizationId),
    db
      .select({ preco: avg(services.priceCents) })
      .from(services)
      .where(and(eq(services.organizationId, ctx.organizationId), eq(services.active, true))),
  ]);

  const medio = Math.round(Number(media?.preco ?? 0));

  return (
    <PagamentosView
      conta={conta ? { ...conta, conferidaEm: conta.conferidaEm?.toISOString() ?? null } : null}
      regra={regra}
      exemploPrecoCents={medio > 0 ? medio : EXEMPLO_PADRAO_CENTS}
    />
  );
}
