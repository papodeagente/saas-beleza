import { and, asc, eq, sql } from "drizzle-orm";
import { Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { PageHeader, SectionLabel } from "@/components/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { requireSession } from "@/server/auth";

export const metadata = { title: "Gestão — Lumina" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietária",
  admin: "Administração",
  staff: "Recepção",
  professional: "Profissional",
};

const RESOURCE_LABEL: Record<string, string> = {
  room: "Sala",
  cabin: "Cabine",
  equipment: "Equipamento",
};

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default async function ManagementPage() {
  const ctx = await requireSession();

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

  const bookingPath = `/agendar/${ctx.organizationSlug}`;

  return (
    <div>
      <PageHeader title="Gestão" description={ctx.organizationName} />

      <div className="mx-auto max-w-[1120px] space-y-9 px-5 py-6 md:px-8">
        {/* Link público — o ativo que a clínica realmente divulga */}
        <section aria-labelledby="link-publico">
          <SectionLabel>
            <span id="link-publico">Link de agendamento</span>
          </SectionLabel>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">
                <span className="text-ink-tertiary">.../agendar/</span>
                {ctx.organizationSlug}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-tertiary">
                Compartilhe na bio, no WhatsApp e nos anúncios. O cliente agenda sem criar conta.
              </p>
            </div>
            <Link
              href={bookingPath}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-[13px] text-accent transition-colors hover:text-accent-hover"
            >
              Abrir página
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </section>

        {/* Profissionais */}
        <section aria-labelledby="profissionais">
          <SectionLabel>
            <span id="profissionais">Profissionais</span>
          </SectionLabel>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
            {professionalRows.map((professional) => (
              <li key={professional.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={professional.name} size="md" color={professional.color} />
                <span className="min-w-0 flex-[2]">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{professional.name}</span>
                    {!professional.active ? <Badge tone="neutral">Inativo</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-tertiary">
                    {professional.specialty ?? "Sem especialidade definida"}
                  </span>
                </span>
                <span className="hidden flex-1 text-[12px] text-ink-secondary sm:block">
                  {professional.weekdays.length > 0
                    ? professional.weekdays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => WEEKDAYS[d])
                        .join(", ")
                    : "Sem grade definida"}
                </span>
                <span className="w-24 shrink-0 text-right text-[12px] text-ink-secondary">
                  {professional.serviceCount}{" "}
                  {professional.serviceCount === 1 ? "serviço" : "serviços"}
                </span>
                <span className="w-16 shrink-0 text-right text-[13px] tabular text-ink">
                  {professional.commissionBps / 100}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Unidades */}
          <section aria-labelledby="unidades">
            <SectionLabel>
              <span id="unidades">Unidades</span>
            </SectionLabel>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
              {branchRows.map((branch) => (
                <li key={branch.id} className="px-4 py-3">
                  <p className="text-[13px] font-medium text-ink">{branch.name}</p>
                  {branch.address ? (
                    <p className="mt-0.5 text-[12px] text-ink-tertiary">{branch.address}</p>
                  ) : null}
                  <p className="mt-1.5 text-[12px] text-ink-secondary">
                    {resourceRows.filter((r) => r.branchId === branch.id).length > 0
                      ? resourceRows
                          .filter((r) => r.branchId === branch.id)
                          .map((r) => `${RESOURCE_LABEL[r.type]}: ${r.name}`)
                          .join(" · ")
                      : "Nenhuma sala ou equipamento cadastrado"}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* Acessos */}
          <section aria-labelledby="acessos">
            <SectionLabel>
              <span id="acessos">Quem tem acesso</span>
            </SectionLabel>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface-raised">
              {memberRows.map((member) => (
                <li key={member.email} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={member.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{member.name}</span>
                    <span className="block truncate text-[12px] text-ink-tertiary">{member.email}</span>
                  </span>
                  <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                    {ROLE_LABEL[member.role] ?? member.role}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-tertiary">
              <Copy className="size-3" />
              Profissional e usuário são cadastros separados: nem todo profissional precisa de login.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
