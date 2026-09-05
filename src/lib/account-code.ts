/**
 * Código público da conta.
 *
 * Toda clínica precisa de um identificador que dê para ditar por telefone ao
 * suporte. O id numérico não serve: é sequencial, então vaza quantas contas o
 * SaaS tem e é fácil de trocar por engano (12 vira 21). O slug também não:
 * muda de dono junto com o nome da clínica.
 *
 * O alfabeto é o Crockford base32 — sem I, L, O e U. Os três primeiros somem
 * porque se confundem com 1 e 0 quando alguém lê em voz alta ou copia de um
 * papel; o U sai para nenhum código acidental virar palavrão.
 */

const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TAMANHO = 8;

/**
 * Gera um código novo.
 *
 * A fonte é o gerador criptográfico, não `Math.random`: o código não é senha,
 * mas é o que identifica uma conta no atendimento, e uma sequência previsível
 * convidaria alguém a adivinhar códigos alheios para se passar por outro
 * cliente ao telefone. O custo de usar a fonte forte aqui é zero.
 *
 * O alfabeto tem 32 símbolos e 256 é múltiplo de 32, então `byte % 32` é
 * uniforme — nenhum caractere sai mais que os outros.
 *
 * A entropia é de 32^8 (mais de um trilhão). Ainda assim, quem grava precisa
 * tratar o índice único: improvável não é impossível.
 */
export function generateAccountCode(): string {
  const bytes = new Uint8Array(TAMANHO);
  globalThis.crypto.getRandomValues(bytes);

  let bruto = "";
  for (const byte of bytes) {
    bruto += ALFABETO[byte % ALFABETO.length];
  }
  return formatAccountCode(bruto);
}

/** `A3K97QF2` vira `A3K9-7QF2`: dois grupos de quatro se leem sem perder o lugar. */
export function formatAccountCode(bruto: string): string {
  const limpo = bruto.replace(/-/g, "").toUpperCase();
  return `${limpo.slice(0, 4)}-${limpo.slice(4, 8)}`;
}

/**
 * Aceita o código como a pessoa digitar.
 *
 * Quem lê de um papel escreve com espaço, sem traço, em minúsculas, e troca
 * O por 0 e I por 1 — as substituições que o próprio alfabeto tenta evitar.
 * Normalizar aqui é o que faz a busca do suporte funcionar na primeira
 * tentativa.
 */
export function normalizeAccountCode(entrada: string): string | null {
  const limpo = (entrada || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");

  if (limpo.length !== TAMANHO) return null;
  for (const caractere of limpo) {
    if (!ALFABETO.includes(caractere)) return null;
  }
  return formatAccountCode(limpo);
}

/** Confere se o texto já é um código bem formado. */
export function isAccountCode(valor: string): boolean {
  return normalizeAccountCode(valor) !== null;
}
