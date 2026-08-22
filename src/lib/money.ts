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
