import { and, asc, eq, sql } from "drizzle-orm";
import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { db } from "@/db";
import { professionalServices, professionals, serviceCategories, services } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL } from "@/lib/money";
import { requireSession } from "@/server/auth";

export const metadata = { title: "Catálogo — Lumina" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ctx = await requireSession();

  const rows = await db
    .select({
      id: services.id,
      name: services.name,
      description: services.description,
      durationMin: services.durationMin,
      priceCents: services.priceCents,
      costCents: services.costCents,
      onlineBooking: services.onlineBooking,
      active: services.active,
      returnIntervalDays: services.returnIntervalDays,
      requiredResourceType: services.requiredResourceType,
      categoryName: serviceCategories.name,
      categoryPosition: serviceCategories.position,
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
    .groupBy(
      services.id,
      serviceCategories.name,
      serviceCategories.position,
    )
    .orderBy(asc(serviceCategories.position), asc(services.name));

  const grouped = rows.reduce((map, row) => {
    const key = row.categoryName ?? "Sem categoria";
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
    return map;
  }, new Map<string, typeof rows>());

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description={`${rows.length} ${rows.length === 1 ? "serviço" : "serviços"}`}
      />

      <div className="mx-auto max-w-[1120px] px-5 py-6 md:px-8">
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface-raised">
            <EmptyState
              icon={LayoutGrid}
              title="Seu catálogo está vazio"
              description="Cadastre os serviços com duração e preço para que a agenda saiba calcular horários."
            />
          </div>
        ) : (
          <div className="space-y-7">
            {[...grouped.entries()].map(([category, list]) => (
              <section key={category}>
                <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                  {category}
                </h2>
                <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
                  {list.map((service) => {
                    const marginBps =
                      service.priceCents > 0
                        ? Math.round(((service.priceCents - service.costCents) / service.priceCents) * 100)
                        : 0;
                    return (
                      <li key={service.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <span className="min-w-0 flex-[2]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-ink">
                              {service.name}
                            </span>
                            {!service.active ? <Badge tone="neutral">Inativo</Badge> : null}
                            {service.onlineBooking ? (
                              <Badge tone="accent">Agendamento online</Badge>
                            ) : null}
                            {service.requiredResourceType ? (
                              <Badge tone="info">
                                {service.requiredResourceType === "equipment"
                                  ? "Usa equipamento"
                                  : service.requiredResourceType === "room"
                                    ? "Usa sala"
                                    : "Usa cabine"}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">
                            {service.professionals.length > 0
                              ? service.professionals.map((n) => n.split(" ")[0]).join(", ")
                              : "Nenhum profissional habilitado"}
                            {service.returnIntervalDays
                              ? ` · retorno a cada ${service.returnIntervalDays} dias`
                              : ""}
                          </span>
                        </span>

                        <span className="w-16 shrink-0 text-[12px] tabular text-ink-secondary">
                          {service.durationMin} min
                        </span>

                        <span className="w-24 shrink-0 text-right">
                          <span className="block text-[13px] font-medium tabular text-ink">
                            {formatBRL(service.priceCents)}
                          </span>
                          {service.costCents > 0 ? (
                            <span className="block text-[11px] tabular text-ink-tertiary">
                              {marginBps}% de margem
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
