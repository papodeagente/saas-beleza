import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TenantContext } from "@/server/auth";
import { localDateTimeToUtc } from "@/lib/tz";

export type FunnelStageKey = "access" | "booking" | "confirmation" | "attendance" | "closed" | "recurrence";
export type FunnelStageMetric = { key: FunnelStageKey; label: string; value: number; conversion: number };
export type BookingFunnelReport = { stages: FunnelStageMetric[]; accessTrackingSince: string | null };

export async function getBookingFunnel(
  ctx: TenantContext,
  fromISO: string,
  toISO: string,
): Promise<BookingFunnelReport> {
  const start = localDateTimeToUtc(fromISO, "00:00", ctx.timezone);
  const end = localDateTimeToUtc(toISO, "23:59:59", ctx.timezone);
  const { rows } = await db.execute<{
    visits: number;
    bookings: number;
    confirmations: number;
    attendance: number;
    closed: number;
    recurrence: number;
    tracking_since: string | null;
  }>(sql`
    with cohort as (
      select a.*
      from appointments a
      where a.organization_id = ${ctx.organizationId}
        and a.source = 'public'
        and a.created_at between ${start} and ${end}
        and a.status <> 'cancelled'
    )
    select
      (select count(*)::int from booking_page_visits v
        where v.organization_id = ${ctx.organizationId}
          and v.visit_date between ${fromISO}::date and ${toISO}::date) as visits,
      (select min(v.visit_date)::text from booking_page_visits v
        where v.organization_id = ${ctx.organizationId}) as tracking_since,
      count(*)::int as bookings,
      count(*) filter (where exists (
        select 1 from appointment_history h
        where h.appointment_id = cohort.id and h.action = 'status:confirmed'
      ))::int as confirmations,
      count(*) filter (where exists (
        select 1 from appointment_history h
        where h.appointment_id = cohort.id and h.action = 'status:checked_in'
      ))::int as attendance,
      count(*) filter (where exists (
        select 1 from appointment_history h
        where h.appointment_id = cohort.id and h.action = 'status:completed'
      ))::int as closed,
      count(*) filter (where exists (
        select 1 from appointment_history h
        where h.appointment_id = cohort.id and h.action = 'status:completed'
      ) and exists (
        select 1 from appointments previous
        where previous.organization_id = ${ctx.organizationId}
          and previous.customer_id = cohort.customer_id
          and previous.status = 'completed'
          and previous.starts_at < cohort.starts_at
      ))::int as recurrence
    from cohort
  `);
  const row = rows[0] ?? { visits: 0, bookings: 0, confirmations: 0, attendance: 0, closed: 0, recurrence: 0, tracking_since: null };
  const values = [
    Number(row.visits),
    Number(row.bookings),
    Number(row.confirmations),
    Number(row.attendance),
    Number(row.closed),
    Number(row.recurrence),
  ];
  const labels = ["Acessos à agenda", "Agendamentos", "Confirmações", "Comparecimentos", "Fechamentos", "Recorrência"];
  const keys: FunnelStageKey[] = ["access", "booking", "confirmation", "attendance", "closed", "recurrence"];
  return {
    accessTrackingSince: row.tracking_since,
    stages: values.map((value, index) => ({
      key: keys[index],
      label: labels[index],
      value,
      conversion: index === 0 ? 100 : values[index - 1] > 0 ? (value / values[index - 1]) * 100 : 0,
    })),
  };
}
