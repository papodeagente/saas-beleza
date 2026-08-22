import { and, asc, eq, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { PageBody, PageHeader, SectionLabel } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardList } from "@/components/ui/card";
import { db } from "@/db";
import {
  branches,
  organizationMembers,
  professionalServices,
  professionalWorkingHours,
  professionals,
  resources,
  users,
} from "@/db/schema";
import { formatPhone } from "@/lib/phone";
import { requireRole, requireSession } from "@/server/auth";
import { CopyLink } from "./copy-link";

export const metadata = { title: "Gestão — Lumina" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietária",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

/** Ordem de leitura dos recursos de uma unidade, do mais estrutural ao móvel. */
const RESOURCE_KINDS = [
  { type: "room", one: "Sala", many: "Salas" },
  { type: "cabin", one: "Cabine", many: "Cabines" },
  { type: "equipment", one: "Equipamento", many: "Equipamentos" },
] as const;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Cabine Ponta Negra" sob o rótulo "Cabine" vira só "Ponta Negra". */
function withoutKindPrefix(name: string, kind: string): string {
  const prefix = `${kind} `;
  if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = name.slice(prefix.length).trim();
    // "Sala 1" continua "Sala 1": sem o prefixo sobraria um número solto.
    if (/\p{L}/u.test(rest)) return rest;
  }
  return name;
}

function formatCommission(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export default async function ManagementPage() {
  const ctx = await requireSession();
  // Comissão, acessos e unidades são assunto de quem administra a clínica.
  requireRole(ctx, "admin");

  const [professionalRows, branchRows, resourceRows, memberRows] = await Promise.all([
    db
      .select({
        id: professionals.id,
        name: professionals.name,
        specialty: professionals.specialty,
        color: professionals.color,
        commissionBps: professionals.commissionBps,
        active: professionals.active,
        serviceCount: sql<number>`count(distinct ${professionalServices.serviceId})`.mapWith(Number),
        weekdays: sql<number[]>`coalesce(array_agg(distinct ${professionalWorkingHours.weekday}) filter (where ${professionalWorkingHours.weekday} is not null), '{}')`,
      })
      .from(professionals)
      .leftJoin(professionalServices, eq(professionalServices.professionalId, professionals.id))
      .leftJoin(professionalWorkingHours, eq(professionalWorkingHours.professionalId, professionals.id))
      .where(eq(professionals.organizationId, ctx.organizationId))
      .groupBy(professionals.id)
      .orderBy(asc(professionals.name)),
    db
      .select({ id: branches.id, name: branches.name, address: branches.address, phone: branches.phone })
      .from(branches)
      .where(and(eq(branches.organizationId, ctx.organizationId), eq(branches.active, true)))
      .orderBy(asc(branches.name)),
    db
      .select({ id: resources.id, name: resources.name, type: resources.type, branchId: resources.branchId })
      .from(resources)
      .where(eq(resources.organizationId, ctx.organizationId))
      .orderBy(asc(resources.name)),
    db
      .select({ name: users.name, email: users.email, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, ctx.organizationId))
      .orderBy(asc(users.name)),
  ]);

  // Endereço completo — é ele que a clínica cola na bio, não o caminho relativo.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "http";
  const bookingPath = `/agendar/${ctx.organizationSlug}`;
  const bookingUrl = host ? `${proto}://${host}${bookingPath}` : bookingPath;

  return (
    <div>
      <PageHeader title="Gestão" description={ctx.organizationName} />

      <PageBody className="space-y-8">
        {/* Link público — o ativo que a clínica realmente divulga */}
        <section aria-labelledby="link-publico">
          <SectionLabel>
            <span id="link-publico">Link de agendamento</span>
          </SectionLabel>
          <Card className="mt-2.5 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-label break-all text-ink">{bookingUrl.replace(/^https?:\/\//, "")}</p>
              <p className="mt-1 text-caption text-ink-secondary">
                Publique na bio e mande para quem chama: o cliente escolhe o horário sozinho, sem
                criar conta.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="h-11 md:h-9" asChild>
                <Link href={bookingPath} target="_blank" rel="noreferrer">
                  Abrir página
                  <ExternalLink aria-hidden />
                </Link>
              </Button>
              <CopyLink url={bookingUrl} />
            </div>
          </Card>
        </section>

        {/* Profissionais */}
        <section aria-labelledby="profissionais">
          <SectionLabel>
            <span id="profissionais">Profissionais</span>
          </SectionLabel>
          <Card className="mt-2.5">
            {/* Cabeçalho de colunas: "3" e "30%" nunca aparecem sem nome. */}
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 sm:flex">
              <span aria-hidden className="size-8 shrink-0" />
              <span className="flex-[2] text-section">Profissional</span>
              <span className="flex-1 text-section">Dias</span>
              <span className="w-20 shrink-0 text-right text-section">Serviços</span>
              <span className="w-20 shrink-0 text-right text-section">Comissão</span>
            </div>

            <CardList>
              {professionalRows.map((professional) => {
                const days =
                  professional.weekdays.length > 0
                    ? professional.weekdays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => WEEKDAYS[d])
                        .join(", ")
                    : "Sem grade definida";
                const serviceCount = `${professional.serviceCount} ${
                  professional.serviceCount === 1 ? "serviço" : "serviços"
                }`;

                return (
                  <li
                    key={professional.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                  >
                    <Avatar name={professional.name} size="md" color={professional.color} />
                    <span className="min-w-0 flex-[2]">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-label text-ink">{professional.name}</span>
                        {!professional.active ? <Badge tone="neutral">Inativo</Badge> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-caption text-ink-secondary">
                        {professional.specialty ?? "Sem especialidade definida"}
                      </span>
                    </span>

                    {/* Desktop: uma coluna por dado. Celular: uma linha só, com
                        cada número acompanhado do que ele significa. */}
                    <span className="hidden flex-1 text-caption text-ink-secondary sm:block">
                      {days}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-caption tabular text-ink-secondary sm:block">
                      {professional.serviceCount}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-label tabular text-ink sm:block">
                      {formatCommission(professional.commissionBps)}
                    </span>
                    <span className="basis-full text-caption text-ink-secondary sm:hidden">
                      {days} · {serviceCount} · comissão de{" "}
                      {formatCommission(professional.commissionBps)}
                    </span>
                  </li>
                );
              })}
            </CardList>
          </Card>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Unidades */}
          <section className="min-w-0" aria-labelledby="unidades">
            <SectionLabel>
              <span id="unidades">Unidades</span>
            </SectionLabel>
            <Card className="mt-2.5">
              <CardList>
                {branchRows.map((branch) => {
                  const groups = RESOURCE_KINDS.map((kind) => {
                    const names = resourceRows
                      .filter((r) => r.branchId === branch.id && r.type === kind.type)
                      .map((r) => withoutKindPrefix(r.name, kind.one));
                    return { kind, names };
                  }).filter((group) => group.names.length > 0);

                  return (
                    <li key={branch.id} className="px-4 py-3">
                      <p className="text-label text-ink">{branch.name}</p>
                      {branch.address || branch.phone ? (
                        <p className="mt-0.5 text-caption text-ink-secondary">
                          {[branch.address, branch.phone ? formatPhone(branch.phone) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}

                      {/* Um rótulo por tipo, não um rótulo por recurso. */}
                      {groups.length > 0 ? (
                        <dl className="mt-2 space-y-1">
                          {groups.map((group) => (
                            <div key={group.kind.type} className="flex gap-1.5 text-caption">
                              <dt className="shrink-0 text-ink-secondary">
                                {group.names.length === 1 ? group.kind.one : group.kind.many}:
                              </dt>
                              <dd className="min-w-0 text-ink">{group.names.join(", ")}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="mt-2 text-caption text-ink-secondary">
                          Nenhuma sala ou equipamento cadastrado
                        </p>
                      )}
                    </li>
                  );
                })}
              </CardList>
            </Card>
          </section>

          {/* Acessos */}
          <section className="min-w-0" aria-labelledby="acessos">
            <SectionLabel>
              <span id="acessos">Quem tem acesso</span>
            </SectionLabel>
            <Card className="mt-2.5">
              <CardList>
                {memberRows.map((member) => (
                  <li key={member.email} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={member.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-label text-ink">{member.name}</span>
                      <span className="block truncate text-caption text-ink-secondary">
                        {member.email}
                      </span>
                    </span>
                    <Badge tone="neutral">{ROLE_LABEL[member.role] ?? member.role}</Badge>
                  </li>
                ))}
              </CardList>
            </Card>
            <p className="mt-2 text-caption text-ink-secondary">
              Profissional e usuário são cadastros separados: nem todo profissional precisa de login.
            </p>
          </section>
        </div>
      </PageBody>
    </div>
  );
}
