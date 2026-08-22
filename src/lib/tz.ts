import { addDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Única fronteira de timezone da aplicação.
 * Banco guarda timestamptz (UTC); tudo que é "dia", "hora local", "grade"
 * é interpretado no fuso do tenant através destas funções.
 */

/** Início e fim (exclusivo) de um dia local do tenant, em UTC. */
export function dayRangeInTz(day: Date, timezone: string): { start: Date; end: Date } {
  const local = toZonedTime(day, timezone);
  const startLocal = startOfDay(local);
  const start = fromZonedTime(startLocal, timezone);
  const end = fromZonedTime(addDays(startLocal, 1), timezone);
  return { start, end };
}

/** Combina um dia local (yyyy-MM-dd) e hora local (HH:mm[:ss]) num instante UTC. */
export function localDateTimeToUtc(dateISO: string, timeHHmm: string, timezone: string): Date {
  return fromZonedTime(`${dateISO}T${timeHHmm.length === 5 ? `${timeHHmm}:00` : timeHHmm}`, timezone);
}

/** Formatação sempre em pt-BR — o locale nunca é decidido no componente. */
export function formatTz(dateUtc: Date, timezone: string, pattern: string): string {
  return formatInTimeZone(dateUtc, timezone, pattern, { locale: ptBR });
}

/** "Sábado, 22 de agosto" — cabeçalhos de data com a primeira letra maiúscula. */
export function formatTzCapitalized(dateUtc: Date, timezone: string, pattern: string): string {
  const value = formatTz(dateUtc, timezone, pattern);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Dia da semana (0=domingo) no fuso do tenant. */
export function weekdayInTz(dateUtc: Date, timezone: string): number {
  return Number(formatInTimeZone(dateUtc, timezone, "i")) % 7;
}

/** yyyy-MM-dd no fuso do tenant. */
export function dateISOInTz(dateUtc: Date, timezone: string): string {
  return formatInTimeZone(dateUtc, timezone, "yyyy-MM-dd");
}
