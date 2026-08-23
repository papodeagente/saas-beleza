import { Ban, Building2 } from "lucide-react";
import Link from "next/link";
import { PlatformBody, PlatformHeader } from "@/components/platform-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL } from "@/lib/money";
import { formatTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { requirePlatformAdmin } from "@/server/platform-auth";
import { type AccountFilter, listAccounts } from "@/server/services/platform-accounts";
import { AccountFilters } from "./account-filters";

export const metadata = { title: "Contas" };
export const dynamic = "force-dynamic";

/**
 * O painel é operado de um lugar só — as datas aqui são lidas no fuso da
 * plataforma, não no de cada clínica. Misturar os dois faria duas contas
 * vizinhas na lista parecerem ter atividade em dias diferentes pelo mesmo
 * instante.
 */
const PLATFORM_TZ = "America/Sao_Paulo";

const FILTERS: Array<{ value: AccountFilter; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "pagantes", label: "Pagantes" },
  { value: "teste", label: "Em teste" },
  { value: "inadimplentes", label: "Inadimplentes" },
  { value: "suspensas", label: "Suspensas" },
  { value: "canceladas", label: "Canceladas" },
];

const STATUS: Record<string, { label: string; tone: "positive" | "attention" | "info" | "neutral" }> =
  {
    active: { label: "Ativa", tone: "positive" },
    past_due: { label: "Inadimplente", tone: "attention" },
    trialing: { label: "Em teste", tone: "info" },
    paused: { label: "Pausada", tone: "neutral" },
    canceled: { label: "Cancelada", tone: "neutral" },
  };

const CYCLE: Record<string, string> = { monthly: "Mensal", yearly: "Anual" };

/**
 * `max(starts_at)` sai do agregado como string: o driver devolve o timestamp
 * cru e só as COLUNAS mapeadas viram Date. Sem esta conversão a lista quebra
 * na primeira conta que já teve atendimento.
 */
function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeActivity(value: Date | string | null): string {
  const date = toDate(value);
  if (!date) return "Sem uso";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 30) return `Há ${days} dias`;
  return formatTz(date, PLATFORM_TZ, "d MMM yyyy");
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; filtro?: string }>;
}) {
  const ctx = await requirePlatformAdmin();
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.value === params.filtro)?.value ?? "todas";
  const query = params.busca?.trim() ?? "";

  const rows = await listAccounts(ctx, { query, filter });

  // O resumo descreve A SELEÇÃO, não a base inteira: filtrar e ver um total
  // que não bate com a lista abaixo é o jeito mais rápido de perder confiança
  // no painel.
  const paying = rows.filter((r) => r.status === "active" || r.status === "past_due").length;
  const mrrCents = rows.reduce((sum, r) => sum + Number(r.mrrCents), 0);
  const suspended = rows.filter((r) => r.suspendedAt).length;

  return (
    <div>
      <PlatformHeader
        title="Contas"
        description="Todas as clínicas da plataforma, com assinatura e uso lado a lado"
      />

      <PlatformBody className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-3">
          <Resumo
            rotulo={filter === "todas" && !query ? "Contas" : "Contas na seleção"}
            valor={rows.length.toLocaleString("pt-BR")}
            apoio={
              suspended > 0
                ? `${suspended} ${suspended === 1 ? "suspensa" : "suspensas"}`
                : "Nenhuma suspensa"
            }
          />
          <Resumo
            rotulo="Pagantes"
            valor={paying.toLocaleString("pt-BR")}
            apoio="Ativas e inadimplentes"
          />
          <Resumo
            rotulo="MRR somado"
            valor={formatBRL(mrrCents)}
            apoio="Anual entra dividido por 12"
          />
        </section>

        <AccountFilters initialQuery={query} filter={filter} filters={FILTERS} />

        {rows.length === 0 ? (
          <Card>
            {query ? (
              <EmptyState
                icon={Building2}
                title="Nenhuma conta com esse nome"
                description={`Não encontramos nada para "${query}". A busca cobre o nome e o endereço (slug) da clínica.`}
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="Nenhuma conta nesta situação"
                description="Troque o filtro para ver as contas em outras situações de assinatura."
              />
            )}
          </Card>
        ) : (
          <Card>
            {/* Um cabeçalho de coluna — nunca um rótulo repetido linha a linha */}
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 lg:flex">
              <span className="flex-[2] text-section">Conta</span>
              <span className="w-[104px] shrink-0 text-section">Plano</span>
              <span className="w-[116px] shrink-0 text-section">Situação</span>
              <span className="w-[64px] shrink-0 text-section">Ciclo</span>
              <span className="w-[96px] shrink-0 text-right text-section">MRR</span>
              <span className="w-[92px] shrink-0 text-right text-section">Atend. 30d</span>
              <span className="w-[104px] shrink-0 text-right text-section">Atividade</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((account) => {
                const status = account.status ? STATUS[account.status] : null;
                return (
                  <li key={account.id}>
                    <Link
                      href={`/admin/contas/${account.id}`}
                      className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                    >
                      <span className="min-w-0 flex-[2] basis-full lg:basis-auto">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-label text-ink">{account.name}</span>
                          {/* Suspensa se reconhece pelo ícone e pela palavra:
                              quem não distingue as cores continua enxergando. */}
                          {account.suspendedAt ? (
                            <Badge tone="danger">
                              <Ban className="size-3" aria-hidden />
                              Suspensa
                            </Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                          /{account.slug}
                        </span>
                      </span>

                      {/* No celular as colunas viram uma linha só de contexto */}
                      <span className="flex flex-wrap items-center gap-2 lg:hidden">
                        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                        <span className="text-caption text-ink-secondary">
                          {account.planName ?? "Sem plano"} ·{" "}
                          <span className="tabular">
                            {Number(account.mrrCents) > 0
                              ? formatBRL(Number(account.mrrCents))
                              : "sem MRR"}
                          </span>{" "}
                          · {relativeActivity(account.lastActivityAt)}
                        </span>
                      </span>

                      <span className="hidden w-[104px] shrink-0 truncate text-caption text-ink-secondary lg:block">
                        {account.planName ?? "—"}
                      </span>
                      <span className="hidden w-[116px] shrink-0 lg:block">
                        {status ? (
                          <Badge tone={status.tone}>{status.label}</Badge>
                        ) : (
                          <span className="text-caption text-ink-tertiary">Sem assinatura</span>
                        )}
                      </span>
                      <span className="hidden w-[64px] shrink-0 text-caption text-ink-secondary lg:block">
                        {account.cycle ? CYCLE[account.cycle] : "—"}
                      </span>
                      <span
                        className={cn(
                          "hidden w-[96px] shrink-0 text-right tabular text-label lg:block",
                          Number(account.mrrCents) > 0 ? "text-ink" : "text-ink-tertiary",
                        )}
                      >
                        {Number(account.mrrCents) > 0 ? formatBRL(Number(account.mrrCents)) : "—"}
                      </span>
                      <span className="hidden w-[92px] shrink-0 text-right tabular text-caption text-ink-secondary lg:block">
                        {Number(account.appointments30d).toLocaleString("pt-BR")}
                      </span>
                      <span
                        className={cn(
                          "hidden w-[104px] shrink-0 text-right text-caption lg:block",
                          account.lastActivityAt ? "text-ink-secondary" : "text-ink-tertiary",
                        )}
                      >
                        {relativeActivity(account.lastActivityAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {rows.length >= 200 ? (
          <p className="text-caption text-ink-secondary">
            Mostrando as 200 contas de maior MRR. Use a busca para chegar em uma conta específica.
          </p>
        ) : null}
      </PlatformBody>
    </div>
  );
}

function Resumo({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-caption text-ink-secondary">{rotulo}</p>
      <p className="mt-1 tabular text-metric text-ink">{valor}</p>
      <p className="mt-0.5 text-meta text-ink-secondary">{apoio}</p>
    </Card>
  );
}
