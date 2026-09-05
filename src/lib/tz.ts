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

/**
 * Quantos dias de CALENDÁRIO separam duas datas, no fuso do tenant.
 *
 * Existe porque `isToday`, `isYesterday` e `differenceInCalendarDays` do
 * date-fns respondem no fuso de quem está rodando — e quem está rodando é o
 * servidor (UTC em produção) na primeira pintura e o navegador depois. Uma
 * mensagem das 22:30 de terça em Natal é quarta-feira em UTC: o servidor
 * escrevia "Ontem" onde o navegador escrevia "Hoje", e a hora saía três horas
 * adiantada até o React reidratar.
 *
 * A conta é feita sobre `yyyy-MM-dd` no fuso do salão, que é a mesma string dos
 * dois lados. Positivo quando `depois` é mais recente.
 */
export function diasDeCalendarioEmTz(depois: Date, antes: Date, timezone: string): number {
  const emDias = (d: Date) => Date.parse(`${dateISOInTz(d, timezone)}T00:00:00.000Z`);
  return Math.round((emDias(depois) - emDias(antes)) / 86_400_000);
}

/**
 * Os dias de um intervalo inclusivo, como instantes de MEIO-DIA UTC.
 *
 * A agenda representa "um dia do calendário" por um instante ao meio-dia em UTC
 * e lê tudo de volta com `formatTz(dia, "UTC", ...)`. `eachDayOfInterval` do
 * date-fns quebra essa convenção porque normaliza para a meia-noite LOCAL: num
 * navegador a leste de Greenwich a meia-noite do dia 23 é 23:00 do dia 22 em
 * UTC, e a grade da semana inteira aparecia deslocada um dia — "Sábado" no
 * servidor contra "Domingo" no navegador, com o React refazendo a árvore.
 *
 * Meio-dia e não meia-noite: é o único horário que sobrevive a qualquer fuso do
 * planeta sem trocar de data.
 */
export function diasDoIntervaloUtc(inicioISO: string, fimISO: string): Date[] {
  const dias: Date[] = [];
  const fim = Date.parse(`${fimISO}T12:00:00.000Z`);
  for (let t = Date.parse(`${inicioISO}T12:00:00.000Z`); t <= fim; t += 86_400_000) {
    dias.push(new Date(t));
  }
  return dias;
}

/**
 * O fuso do PAINEL DA PLATAFORMA.
 *
 * O super admin olha contas do país inteiro, então não existe "fuso do tenant"
 * aqui. Fixo e explícito é melhor do que o fuso de quem renderizou: o servidor
 * de produção roda em UTC e escrevia a data errada toda noite depois das 21h.
 */
export const FUSO_DA_PLATAFORMA = "America/Sao_Paulo";

/** yyyy-MM-dd no fuso do tenant. */
export function dateISOInTz(dateUtc: Date, timezone: string): string {
  return formatInTimeZone(dateUtc, timezone, "yyyy-MM-dd");
}
