import { Users } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRLCompact } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import { type CustomerFilter, countCustomers, listCustomers } from "@/server/services/customer-service";
import { CustomerSearch } from "./customer-search";

export const metadata = { title: "Clientes — Lumina" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: CustomerFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "retorno", label: "No período de retorno" },
  { value: "novos", label: "Novos" },
  { value: "inativos", label: "Inativos" },
];

function relativeVisit(date: Date | null, timezone: string): string {
  if (!date) return "Ainda não veio";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 30) return `Há ${days} dias`;
  return formatTz(date, timezone, "d MMM yyyy");
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; filtro?: string }>;
}) {
  const ctx = await requireSession();
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.value === params.filtro)?.value ?? "todos") as CustomerFilter;
  const query = params.busca ?? "";

  const [rows, total] = await Promise.all([
    listCustomers(ctx, { query, filter }),
    countCustomers(ctx),
  ]);

  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`${total} ${total === 1 ? "cliente cadastrado" : "clientes cadastrados"}`}
      />

      <div className="mx-auto max-w-[1120px] px-5 py-5 md:px-8">
        <CustomerSearch initialQuery={query} filter={filter} filters={FILTERS} />

        {rows.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius)] border border-line bg-surface-raised">
            {query ? (
              <EmptyState
                icon={Users}
                title="Nenhum cliente com esse nome"
                description={`Não encontramos ninguém para "${query}". Tente parte do nome ou o telefone.`}
              />
            ) : filter === "retorno" ? (
              <EmptyState
                icon={Users}
                title="Ninguém em atraso para voltar"
                description="Todos os clientes que já vieram estão dentro do período esperado ou já têm horário marcado."
              />
            ) : (
              <EmptyState
                icon={Users}
                title="Sua base de clientes começa aqui"
                description="Cada atendimento agendado cria ou atualiza um cliente. Comece marcando o primeiro."
                action={
                  <Button variant="primary" size="md" asChild>
                    <Link href="/agenda">Ir para a agenda</Link>
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
            {/* Um cabeçalho, não um rótulo repetido em cada linha */}
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary sm:flex">
              <span className="w-8 shrink-0" />
              <span className="flex-[2]">Cliente</span>
              <span className="flex-1">Última visita</span>
              <span className="flex-1">Próximo</span>
              <span className="w-20 shrink-0 text-right">Total gasto</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/clientes/${customer.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                  >
                    <Avatar name={customer.name} size="md" />
                    <span className="min-w-0 flex-[2]">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-ink">{customer.name}</span>
                        {customer.tags.map((tag) => (
                          <Badge key={tag} tone={tag === "VIP" ? "accent" : "neutral"}>
                            {tag}
                          </Badge>
                        ))}
                      </span>
                      {customer.phone ? (
                        <span className="mt-0.5 block text-[12px] text-ink-tertiary">
                          {formatPhone(customer.phone)}
                        </span>
                      ) : null}
                    </span>

                    <span className="hidden flex-1 text-[12px] text-ink-secondary sm:block">
                      {relativeVisit(customer.lastVisitAt, ctx.timezone)}
                    </span>

                    <span
                      className={cn(
                        "hidden flex-1 text-[12px] sm:block",
                        customer.nextAppointmentAt ? "text-positive" : "text-ink-tertiary",
                      )}
                    >
                      {customer.nextAppointmentAt
                        ? formatTz(customer.nextAppointmentAt, ctx.timezone, "d MMM', 'HH:mm")
                        : "—"}
                    </span>

                    <span
                      className={cn(
                        "w-20 shrink-0 text-right text-[13px] tabular",
                        customer.totalSpentCents > 0 ? "font-medium text-ink" : "text-ink-tertiary",
                      )}
                    >
                      {customer.totalSpentCents > 0 ? formatBRLCompact(customer.totalSpentCents) : "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
