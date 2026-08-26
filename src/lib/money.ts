const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/** R$ 8.420 — sem centavos, para números operacionais grandes. */
export function formatBRLCompact(cents: number): string {
  return brlCompact.format(Math.round(cents / 100));
}

/** "1.234,56" | "1234" → centavos. Retorna null se inválido. */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/[R$\s.]/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * ["R$", "180"] — símbolo e número separados, e centavos zerados de fora.
 *
 * O símbolo sai em `ink-secondary` e o número em `ink`: a diferença de cor já
 * rebaixa o "R$" sem exigir um tamanho fora da escala. E salão anuncia
 * "R$ 180", não "R$ 180,00" — o par de zeros só existe em nota fiscal.
 * Preço quebrado continua mostrando os centavos, porque aí eles informam.
 */
export function precoPartido(cents: number): [string, string] {
  const redondo = cents % 100 === 0;
  return [
    "R$",
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: redondo ? 0 : 2,
      maximumFractionDigits: redondo ? 0 : 2,
    }).format(cents / 100),
  ];
}
