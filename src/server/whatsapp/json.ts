/**
 * Leitura de payload externo.
 *
 * O que chega da uazapi não tem contrato estável: campos mudam de nome, de
 * profundidade e de tipo entre versões. Em vez de declarar `any` e perder a
 * checagem inteira, estes ajudantes navegam com segurança e devolvem tipos
 * conhecidos — o desconhecido fica isolado aqui.
 */

export type Json = unknown;

/** Percorre um caminho aninhado sem estourar em nada que falte. */
export function get(value: Json, ...path: string[]): Json {
  let atual: Json = value;
  for (const chave of path) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, Json>)[chave];
  }
  return atual;
}

export function asString(value: Json): string {
  return typeof value === "string" ? value : "";
}

export function asBool(value: Json): boolean {
  return value === true;
}

export function asNumber(value: Json): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asArray(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

export function asRecord(value: Json): Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}

/** Primeiro valor de texto não vazio — o padrão de leitura defensiva. */
export function firstString(...candidates: Json[]): string {
  for (const candidato of candidates) {
    const texto = asString(candidato);
    if (texto) return texto;
  }
  return "";
}
