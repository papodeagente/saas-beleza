import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  organizationMembers,
  organizations,
  plans,
  subscriptionEvents,
  subscriptions,
  users,
} from "@/db/schema";
import type { PlatformContext } from "@/server/platform-auth";

/**
 * Gestão de contas — cross-tenant por definição. Nunca importar de tela de
 * clínica: aqui não existe `organizationId` no contexto, e é justamente esse
 * o poder que o painel da plataforma tem.
 */

const MRR_CASE = sql<number>`
  case when ${subscriptions.cycle} = 'yearly'
    then round(${subscriptions.priceCents}::numeric / 12)::int
    else ${subscriptions.priceCents}
  end
`;

export type AccountFilter = "todas" | "pagantes" | "teste" | "inadimplentes" | "canceladas" | "suspensas";

export type AccountRow = {
  id: number;
  name: string;
  slug: string;
  createdAt: Date;
  suspendedAt: Date | null;
  planName: string | null;
  status: string | null;
  cycle: string | null;
  mrrCents: number;
  trialEndsAt: Date | null;
  lastActivityAt: Date | null;
  appointments30d: number;
};

export async function listAccounts(
  _ctx: PlatformContext,
  options: { query?: string; filter?: AccountFilter } = {},
): Promise<AccountRow[]> {
  const { query, filter = "todas" } = options;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const activity = db
    .select({
      organizationId: appointments.organizationId,
      last: sql<Date>`max(${appointments.startsAt})`.as("last"),
      recent: sql<number>`count(*) filter (where ${appointments.startsAt} >= ${thirtyDaysAgo.toISOString()})::int`.as(
        "recent",
      ),
    })
    .from(appointments)
    .groupBy(appointments.organizationId)
    .as("activity");

  const conditions = [];
  if (query?.trim()) {
    const term = `%${query.trim()}%`;
    conditions.push(or(ilike(organizations.name, term), ilike(organizations.slug, term))!);
  }
  if (filter === "pagantes") conditions.push(inArray(subscriptions.status, ["active", "past_due"]));
  if (filter === "teste") conditions.push(eq(subscriptions.status, "trialing"));
  if (filter === "inadimplentes") conditions.push(eq(subscriptions.status, "past_due"));
  if (filter === "canceladas") conditions.push(eq(subscriptions.status, "canceled"));
  if (filter === "suspensas") conditions.push(sql`${organizations.suspendedAt} is not null`);

  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
      suspendedAt: organizations.suspendedAt,
      planName: plans.name,
      status: subscriptions.status,
      cycle: subscriptions.cycle,
      mrrCents: sql<number>`coalesce(case when ${subscriptions.status} in ('active','past_due') then ${MRR_CASE} else 0 end, 0)`,
      trialEndsAt: subscriptions.trialEndsAt,
      lastActivityAt: activity.last,
      appointments30d: sql<number>`coalesce(${activity.recent}, 0)`,
    })
    .from(organizations)
    .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .leftJoin(activity, eq(activity.organizationId, organizations.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sql`coalesce(case when ${subscriptions.status} in ('active','past_due') then ${MRR_CASE} else 0 end, 0)`), asc(organizations.name))
    .limit(200);
}

export type AccountDetail = {
  organization: typeof organizations.$inferSelect;
  subscription:
    | (typeof subscriptions.$inferSelect & { planName: string; planSlug: string })
    | null;
  mrrCents: number;
  members: Array<{ name: string; email: string; role: string }>;
  usage: {
    appointments30d: number;
    appointmentsTotal: number;
    lastActivityAt: Date | null;
    customers: number;
    professionals: number;
    branches: number;
  };
  timeline: Array<{
    id: number;
    kind: string;
    occurredAt: Date;
    mrrBeforeCents: number;
    mrrAfterCents: number;
    note: string | null;
    source: string;
  }>;
};

export async function getAccount(
  _ctx: PlatformContext,
  organizationId: number,
): Promise<AccountDetail | null> {
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [subRows, memberRows, timeline, usageRows] = await Promise.all([
    db
      .select({
        subscription: subscriptions,
        planName: plans.name,
        planSlug: plans.slug,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1),
    db
      .select({ name: users.name, email: users.email, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(asc(users.name)),
    db
      .select({
        id: subscriptionEvents.id,
        kind: subscriptionEvents.kind,
        occurredAt: subscriptionEvents.occurredAt,
        mrrBeforeCents: subscriptionEvents.mrrBeforeCents,
        mrrAfterCents: subscriptionEvents.mrrAfterCents,
        note: subscriptionEvents.note,
        source: subscriptionEvents.source,
      })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.organizationId, organizationId))
      .orderBy(desc(subscriptionEvents.occurredAt))
      .limit(40),
    db.execute<{
      appointments_total: number;
      appointments_30d: number;
      last_activity: Date | null;
      customers: number;
      professionals: number;
      branches: number;
    }>(sql`
      select
        (select count(*) from appointments where organization_id = ${organizationId})::int as appointments_total,
        (select count(*) from appointments where organization_id = ${organizationId} and starts_at >= ${thirtyDaysAgo.toISOString()})::int as appointments_30d,
        (select max(starts_at) from appointments where organization_id = ${organizationId}) as last_activity,
        (select count(*) from customers where organization_id = ${organizationId})::int as customers,
        (select count(*) from professionals where organization_id = ${organizationId})::int as professionals,
        (select count(*) from branches where organization_id = ${organizationId})::int as branches
    `),
  ]);

  const sub = subRows[0];
  const usage = (usageRows.rows as Array<Record<string, number | Date | null>>)[0];

  const mrrCents =
    sub && ["active", "past_due"].includes(sub.subscription.status)
      ? sub.subscription.cycle === "yearly"
        ? Math.round(sub.subscription.priceCents / 12)
        : sub.subscription.priceCents
      : 0;

  return {
    organization,
    subscription: sub
      ? { ...sub.subscription, planName: sub.planName, planSlug: sub.planSlug }
      : null,
    mrrCents,
    members: memberRows,
    usage: {
      appointmentsTotal: Number(usage?.appointments_total ?? 0),
      appointments30d: Number(usage?.appointments_30d ?? 0),
      lastActivityAt: (usage?.last_activity as Date | null) ?? null,
      customers: Number(usage?.customers ?? 0),
      professionals: Number(usage?.professionals ?? 0),
      branches: Number(usage?.branches ?? 0),
    },
    timeline,
  };
}

export async function listPlans() {
  return db.select().from(plans).orderBy(asc(plans.position), asc(plans.name));
}
