import { Users } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRLCompact } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import {
  type CustomerFilter,
  countCustomers,
  getCustomerFormOptions,
  listCustomers,
} from "@/server/services/customer-service";
import { CustomerSearch } from "./customer-search";
import { NewCustomerButton } from "./new-customer-button";

export const metadata = { title: "Clientes" };
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

  const [rows, total, formOptions] = await Promise.all([
    listCustomers(ctx, { query, filter }),
    countCustomers(ctx),
    getCustomerFormOptions(ctx),
  ]);

  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`${total} ${total === 1 ? "cliente cadastrado" : "clientes cadastrados"}`}
        actions={<NewCustomerButton options={formOptions} />}
      />

      <PageBody>
        <CustomerSearch initialQuery={query} filter={filter} filters={FILTERS} />

        {rows.length === 0 ? (
          <div className="mt-4 rounded-card bg-surface-raised shadow-card">
            {query ? (
              <EmptyState
                icon={Users}
                title="Nenhum cliente com esse nome"
                description={`Não encontramos ninguém para "${query}". Tente parte do nome ou o telefone.`}
                action={<NewCustomerButton options={formOptions} label="Cadastrar cliente" />}
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
                description="Cadastre quem já é cliente da casa, ou deixe que o agendamento online e a agenda criem as fichas conforme os atendimentos acontecem."
                action={<NewCustomerButton options={formOptions} label="Cadastrar primeiro cliente" />}
              />
            )}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-card bg-surface-raised shadow-card">
            {/* Um cabeçalho, não um rótulo repetido em cada linha */}
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 sm:flex">
              <span className="w-8 shrink-0" />
              <span className="flex-[2] text-section">Cliente</span>
              <span className="flex-1 text-section">Última visita</span>
              <span className="flex-1 text-section">Próximo</span>
              <span className="w-20 shrink-0 text-right text-section">Total</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((customer) => {
                /**
                 * Contato que chegou pelo WhatsApp guarda o telefone na coluna
                 * `name` até alguém identificá-lo, e a linha imprimia o mesmo
                 * número duas vezes, um em cima do outro. Repetição não é dado:
                 * o telefone é a única identidade que existe, então ele fica no
                 * título e a linha de apoio passa a dizer o que falta.
                 *
                 * A regra é a MESMA do avatar (`initials`): conta como nome só
                 * quem tem uma palavra começando por letra. Duplicá-la aqui é
                 * deliberado — `initials` mora num módulo "use client" e esta
                 * página é servidor; importar de lá devolveria uma referência
                 * de cliente, não a função.
                 */
                const temNome = /(?:^|\s)\p{L}/u.test(customer.name);
                const telefone = customer.phone ? formatPhone(customer.phone) : null;
                const titulo = temNome || !telefone ? customer.name : telefone;
                const apoio = temNome ? (telefone ?? "Sem telefone") : "Ainda sem nome";
                return (
                <li key={customer.id}>
                  <Link
                    href={`/clientes/${customer.id}`}
                    className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                  >
                    <Avatar name={customer.name} size="md" />
                    <span className="min-w-0 flex-[2]">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-label text-ink">{titulo}</span>
                        {customer.tags.map((tag) => (
                          <Badge key={tag} tone={tag === "VIP" ? "accent" : "neutral"}>
                            {tag}
                          </Badge>
                        ))}
                      </span>
                      <span className="mt-0.5 block text-caption text-ink-secondary">
                        {apoio}
                        {/* No celular as colunas somem: o que importa vem para cá */}
                        <span className="sm:hidden">
                          {" · "}
                          {relativeVisit(customer.lastVisitAt, ctx.timezone)}
                        </span>
                      </span>
                    </span>

                    <span className="hidden flex-1 text-caption text-ink-secondary sm:block">
                      {relativeVisit(customer.lastVisitAt, ctx.timezone)}
                    </span>

                    <span
                      className={cn(
                        "hidden flex-1 text-caption sm:block",
                        customer.nextAppointmentAt ? "text-positive" : "text-ink-tertiary",
                      )}
                    >
                      {customer.nextAppointmentAt
                        ? formatTz(customer.nextAppointmentAt, ctx.timezone, "d MMM', 'HH:mm")
                        : "—"}
                    </span>

                    <span
                      className={cn(
                        "w-20 shrink-0 text-right tabular text-label",
                        customer.totalSpentCents > 0 ? "text-ink" : "text-ink-tertiary",
                      )}
                    >
                      {customer.totalSpentCents > 0 ? formatBRLCompact(customer.totalSpentCents) : "—"}
                    </span>
                  </Link>
                </li>
                );
              })}
            </ul>
          </div>
        )}
      </PageBody>
    </div>
  );
}
