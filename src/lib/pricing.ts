/**
 * A conta do plano anual, em um lugar só.
 *
 * O painel e o site mostram o mesmo desconto, e é justamente por isso que ele
 * não pode ser calculado duas vezes: no dia em que uma das cópias arredondar
 * diferente, o cliente vê um número na página de preço e outro na fatura.
 *
 * Convenção do schema: `yearlyPriceCents` é o ANO INTEIRO, não o mês
 * equivalente. Tratar como mensal multiplica o preço por doze na tela.
 */

export type AnnualDeal = {
  /** Quanto sai o mês quando se paga o ano inteiro. */
  equivalentMonthlyCents: number;
  /** Diferença entre doze mensalidades e o preço do ano. */
  savedCents: number;
  /** Fração economizada (0.167 = 16,7%). */
  ratio: number;
  /** A economia dita em mensalidades: "2 meses de graça". */
  months: number;
};

export function annualDeal(monthlyCents: number, yearlyCents: number): AnnualDeal {
  const equivalentMonthlyCents = Math.round(yearlyCents / 12);
  if (monthlyCents <= 0) {
    return { equivalentMonthlyCents, savedCents: 0, ratio: 0, months: 0 };
  }
  const fullCents = monthlyCents * 12;
  const savedCents = fullCents - yearlyCents;
  return {
    equivalentMonthlyCents,
    savedCents,
    ratio: savedCents / fullCents,
    months: savedCents / monthlyCents,
  };
}

export function formatPercent(ratio: number): string {
  return ratio.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 });
}

/** "2 meses" — a economia anual dita do jeito que dono de clínica calcula. */
export function formatMonths(months: number): string {
  const rounded = Math.round(months * 10) / 10;
  const label = rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `${label} ${rounded === 1 ? "mês" : "meses"}`;
}
