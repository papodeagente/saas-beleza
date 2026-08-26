import { and, asc, eq, sql } from "drizzle-orm";
import { LayoutGrid } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { products, professionalServices, professionals, serviceCategories, services } from "@/db/schema";
import { requireSession } from "@/server/auth";
import { CatalogForms } from "./catalog-forms";

export const metadata = { title: "Catálogo" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ctx = await requireSession();

  /**
   * Margem é custo interno: a recepção precisa do preço e da duração para
   * atender, não da rentabilidade do serviço.
   */
  const canSeeMargin = ctx.role === "admin" || ctx.role === "owner";
  const canManage = canSeeMargin;

  const [rows, productRows, professionalOptions] = await Promise.all([
    db
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMin: services.durationMin,
        priceCents: services.priceCents,
        costCents: services.costCents,
        commissionBps: services.commissionBps,
        onlineBooking: services.onlineBooking,
        active: services.active,
        returnIntervalDays: services.returnIntervalDays,
        requiredResourceType: services.requiredResourceType,
        categoryName: serviceCategories.name,
        professionalNames: sql<
          string[]
        >`coalesce(array_agg(distinct ${professionals.name}) filter (where ${professionals.name} is not null), '{}')`,
        // Os ids vêm junto porque o formulário de edição precisa marcar as
        // caixas: só o nome não diz ao React qual profissional já está ligado.
        professionalIds: sql<
          number[]
        >`coalesce(array_agg(distinct ${professionalServices.professionalId}) filter (where ${professionalServices.professionalId} is not null), '{}')`,
      })
      .from(services)
      .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .leftJoin(
        professionalServices,
        and(
          eq(professionalServices.serviceId, services.id),
          eq(professionalServices.organizationId, ctx.organizationId),
        ),
      )
      .leftJoin(professionals, eq(professionals.id, professionalServices.professionalId))
      .where(eq(services.organizationId, ctx.organizationId))
      .groupBy(services.id, serviceCategories.name, serviceCategories.position)
      .orderBy(asc(serviceCategories.position), asc(services.name)),
    db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        sku: products.sku,
        priceCents: products.priceCents,
        costCents: products.costCents,
        stockQty: products.stockQty,
        active: products.active,
        categoryName: serviceCategories.name,
      })
      .from(products)
      .leftJoin(serviceCategories, eq(serviceCategories.id, products.categoryId))
      .where(eq(products.organizationId, ctx.organizationId))
      .orderBy(asc(serviceCategories.position), asc(products.name)),
    db
      .select({ id: professionals.id, name: professionals.name })
      .from(professionals)
      .where(and(eq(professionals.organizationId, ctx.organizationId), eq(professionals.active, true)))
      .orderBy(asc(professionals.name)),
  ]);

  const description =
    rows.length === 0 && productRows.length === 0
      ? "Nenhum item cadastrado"
      : `${rows.length} ${rows.length === 1 ? "serviço" : "serviços"} · ${productRows.length} ${productRows.length === 1 ? "produto" : "produtos"}`;

  return (
    <div>
      <PageHeader title="Catálogo" description={description} />

      <PageBody>
        {rows.length === 0 && productRows.length === 0 && !canManage ? (
          <Card>
            <EmptyState
              icon={LayoutGrid}
              title="Seu catálogo está vazio"
              description="Cadastre os serviços com duração e preço para que a agenda saiba calcular horários."
            />
          </Card>
        ) : (
          <CatalogForms
            professionals={professionalOptions}
            /*
              Duas correções acontecem nesta fronteira, e as duas são sobre o
              que ATRAVESSA para o navegador.

              1. `array_agg` de bigint volta do Postgres como TEXTO — o
                 `sql<number[]>` acima é anotação de tipo, não conversão. Sem o
                 `Number`, a caixa do profissional nunca aparece marcada (o
                 `includes` compara número com string) e salvar qualquer serviço
                 com profissional vinculado morre em "expected number, received
                 string". Quebrava 6 dos 8 serviços da conta.

              2. Custo e comissão só viajam para quem pode ver margem. A lista
                 virou componente de cliente, e componente de cliente serializa
                 TODAS as props no HTML — a coluna "Margem" sumia da tela da
                 recepção enquanto o custo do Botox ia junto no Ctrl+U. Zerar
                 aqui não tira dado de formulário nenhum: quem não vê margem
                 também não abre a gaveta (canManage === canSeeMargin).
            */
            services={rows.map(({ costCents, commissionBps, ...resto }) => ({
              ...resto,
              costCents: canSeeMargin ? costCents : 0,
              commissionBps: canSeeMargin ? commissionBps : null,
              professionalIds: [...resto.professionalIds].map(Number),
            }))}
            products={productRows.map(({ costCents, ...resto }) => ({
              ...resto,
              costCents: canSeeMargin ? costCents : 0,
            }))}
            canSeeMargin={canSeeMargin}
            canManage={canManage}
          />
        )}

        {rows.length === 0 && productRows.length === 0 && canManage ? (
          <Card className="mt-6">
            <EmptyState
              icon={LayoutGrid}
              title="Seu catálogo está vazio"
              description="Cadastre os serviços com duração e preço para que a agenda saiba calcular horários."
            />
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}
