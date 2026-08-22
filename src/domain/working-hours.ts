/**
 * Vocabulário da jornada de trabalho.
 *
 * Módulo puro (sem I/O, sem "server-only"): a tela que edita a grade e o
 * serviço que a grava usam a MESMA validação. Sem isso, a tela aceitaria um
 * período invertido e o erro só apareceria como falha genérica no servidor.
 */

/** Período de atendimento dentro de um dia, no fuso do tenant. */
export type TimeRange = { startTime: string; endTime: string };

/** 0 = domingo … 6 = sábado, a mesma convenção da coluna `weekday` no banco. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const WEEKDAY_LABEL = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

export function isValidTime(value: string): boolean {
  return HHMM.test(value.trim());
}

/** O banco guarda `time` ("09:00:00"); a tela e a comparação usam "09:00". */
export function toHHmm(value: string): string {
  return value.trim().slice(0, 5);
}

export function minutesOfTime(value: string): number {
  const [hour, minute] = toHHmm(value).split(":");
  return Number(hour) * 60 + Number(minute);
}

export function sortRanges(ranges: TimeRange[]): TimeRange[] {
  return [...ranges].sort((a, b) => minutesOfTime(a.startTime) - minutesOfTime(b.startTime));
}

/**
 * Mensagem de erro em português para o dia inteiro, ou null quando está
 * consistente. Devolve uma frase só: quem edita corrige um problema por vez.
 */
export function validateDayRanges(ranges: TimeRange[]): string | null {
  for (const range of ranges) {
    if (!isValidTime(range.startTime) || !isValidTime(range.endTime)) {
      return "Informe início e fim no formato 24h, como 09:00.";
    }
    if (minutesOfTime(range.endTime) <= minutesOfTime(range.startTime)) {
      return "O fim do período precisa ser depois do início.";
    }
  }

  const ordered = sortRanges(ranges);
  for (let i = 1; i < ordered.length; i++) {
    // Encostar é permitido (12:00 fecha e 12:00 abre); invadir, não.
    if (minutesOfTime(ordered[i].startTime) < minutesOfTime(ordered[i - 1].endTime)) {
      return "Dois períodos do mesmo dia estão sobrepostos.";
    }
  }
  return null;
}

/** Resumo curto para a lista: "09:00–12:00 · 14:00–18:00" ou "Não atende". */
export function describeDay(ranges: TimeRange[]): string {
  if (ranges.length === 0) return "Não atende";
  return sortRanges(ranges)
    .map((r) => `${toHHmm(r.startTime)}–${toHHmm(r.endTime)}`)
    .join(" · ");
}
