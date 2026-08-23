import { and, asc, eq, sql } from "drizzle-orm";
import { LayoutGrid, Package } from "lucide-react";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { products, professionalServices, professionals, serviceCategories, services } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { CatalogForms } from "./catalog-forms";

export const metadata = { title: "Catálogo" };
export const dynamic = "force-dynamic";

const RESOURCE_NEED: Record<string, string> = {
  room: "precisa de sala",
  cabin: "precisa de cabine",
  equipment: "precisa de equipamento",
};

export default async function CatalogPage() {
  const ctx = await requireSession();

  /**
   * Margem é custo interno: a recepção precisa do preço e da duração para
   * atender, não da rentabilidade do serviço.
   */
  const canSeeMargin = ctx.role === "admin" || ctx.role === "owner";
  const canManage = canSeeMargin;

  const [rows, productRows, professionalOptions] = await Promise.all([db
    .select({
      id: services.id,
      name: services.name,
      durationMin: services.durationMin,
      priceCents: services.priceCents,
      costCents: services.costCents,
      onlineBooking: services.onlineBooking,
      active: services.active,
      returnIntervalDays: services.returnIntervalDays,
      requiredResourceType: services.requiredResourceType,
      categoryName: serviceCategories.name,
      professionals: sql<string[]>`coalesce(array_agg(distinct ${professionals.name}) filter (where ${professionals.name} is not null), '{}')`,
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
    db.select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      priceCents: products.priceCents,
      costCents: products.costCents,
      stockQty: products.stockQty,
      active: products.active,
      categoryName: serviceCategories.name,
    }).from(products).leftJoin(serviceCategories, eq(serviceCategories.id, products.categoryId)).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(serviceCategories.position), asc(products.name)),
    db.select({ id: professionals.id, name: professionals.name }).from(professionals).where(and(
      eq(professionals.organizationId, ctx.organizationId),
      eq(professionals.active, true),
    )).orderBy(asc(professionals.name)),
  ]);

  const grouped = rows.reduce((map, row) => {
    const key = row.categoryName ?? "Sem categoria";
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
    return map;
  }, new Map<string, typeof rows>());

  const description =
    rows.length === 0 && productRows.length === 0
      ? "Nenhum item cadastrado"
      : `${rows.length} ${rows.length === 1 ? "serviço" : "serviços"} · ${productRows.length} ${productRows.length === 1 ? "produto" : "produtos"}`;

  return (
    <div>
      <PageHeader title="Catálogo" description={description} />

      <PageBody className="space-y-8">
        {canManage ? <section aria-labelledby="catalogo-cadastros"><SectionLabel><span id="catalogo-cadastros">Cadastros</span></SectionLabel><div className="mt-2.5"><CatalogForms professionals={professionalOptions} /></div></section> : null}

        {rows.length === 0 && productRows.length === 0 ? (
          <Card>
            <EmptyState
              icon={LayoutGrid}
              title="Seu catálogo está vazio"
              description="Cadastre os serviços com duração e preço para que a agenda saiba calcular horários."
            />
          </Card>
        ) : (
          <div className="space-y-8">
            {rows.length ? <section aria-labelledby="servicos-catalogo"><SectionLabel><span id="servicos-catalogo">Serviços</span></SectionLabel><div className="mt-2.5 space-y-6">
            {[...grouped.entries()].map(([category, list]) => (
              <Card key={category}>
                {/* Categoria e cabeçalho de colunas na mesma linha: os números
                    da direita nunca aparecem sem dizer o que são. */}
                <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                  <h2 className="min-w-0 flex-[2] text-card text-ink">{category}</h2>
                  <span className="hidden w-16 shrink-0 text-section sm:block">Duração</span>
                  <span className="hidden w-24 shrink-0 text-right text-section sm:block">Preço</span>
                  {canSeeMargin ? (
                    <span className="hidden w-16 shrink-0 text-right text-section sm:block">Margem</span>
                  ) : null}
                </div>

                <CardList>
                  {list.map((service) => {
                    const marginPct =
                      service.priceCents > 0 && service.costCents > 0
                        ? Math.round(((service.priceCents - service.costCents) / service.priceCents) * 100)
                        : null;

                    const meta = [
                      service.professionals.length > 0
                        ? service.professionals.map((n) => n.split(" ")[0]).join(", ")
                        : "Nenhum profissional habilitado",
                      service.requiredResourceType
                        ? RESOURCE_NEED[service.requiredResourceType]
                        : null,
                      service.returnIntervalDays
                        ? `retorno a cada ${service.returnIntervalDays} dias`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <li
                        key={service.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3"
                      >
                        {/* No celular o nome ocupa a linha inteira: quem é o
                            serviço nunca é o dado sacrificado pela coluna. */}
                        <span className="min-w-0 basis-full sm:flex-[2] sm:basis-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-label text-ink">{service.name}</span>
                            {!service.active ? <Badge tone="neutral">Inativo</Badge> : null}
                            {/* O normal é aceitar agendamento online — só a
                                exceção merece um selo. */}
                            {!service.onlineBooking ? (
                              <Badge tone="neutral">Fora do agendamento online</Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                            {meta}
                          </span>
                        </span>

                        <span className="w-16 shrink-0 text-caption tabular text-ink-secondary">
                          {service.durationMin} min
                        </span>

                        <span className="w-24 shrink-0 text-right text-label tabular text-ink">
                          {formatBRL(service.priceCents)}
                        </span>

                        {canSeeMargin ? (
                          <span className="shrink-0 text-caption tabular text-ink-secondary sm:w-16 sm:text-right">
                            {marginPct !== null ? `${marginPct}%` : "—"}
                            {/* Sem cabeçalho de coluna no celular, o número
                                carrega o próprio rótulo. */}
                            <span className="sm:sr-only"> de margem</span>
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </CardList>
              </Card>
            ))}
            </div></section> : null}

            {productRows.length ? <section aria-labelledby="produtos-catalogo"><SectionLabel><span id="produtos-catalogo">Produtos</span></SectionLabel><Card className="mt-2.5"><CardList>{productRows.map((product) => {
              const margin = product.priceCents > 0 ? Math.round(((product.priceCents - product.costCents) / product.priceCents) * 100) : null;
              return <li key={product.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"><Package className="size-4 shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="text-label text-ink">{product.name}</span>{!product.active ? <Badge tone="neutral">Inativo</Badge> : null}</span><span className="block text-caption text-ink-secondary">{[product.categoryName, product.sku ? `SKU ${product.sku}` : null, `${product.stockQty} em estoque`].filter(Boolean).join(" · ")}</span></span><span className="text-label tabular text-ink">{formatBRL(product.priceCents)}</span>{canSeeMargin ? <span className="w-14 text-right text-caption text-ink-secondary">{margin === null ? "—" : `${margin}%`}</span> : null}</li>;
            })}</CardList></Card></section> : null}
          </div>
        )}
      </PageBody>
    </div>
  );
}
