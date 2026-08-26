/**
 * Quantos horários a cliente REALMENTE vê num dia.
 *
 * A regra mora aqui, e num módulo puro, porque ela é aplicada em dois lugares
 * que precisam concordar: a fita de dias, que anuncia quantos horários o dia
 * tem, e a grade, que desenha os chips. Enquanto os dois números saíam de
 * fontes diferentes, a mesma tela dizia "31 horários livres" no rótulo falado
 * do dia e "16 horários disponíveis" no aviso ao vivo, logo abaixo — medido na
 * conta ENTUR, 390x844, com leitor de tela.
 *
 * A regra em si: um muro de trinta e dois chips de quinze em quinze minutos não
 * é escolha, é ruído. Acima de 20 opções o passo dobra para 30 minutos —
 * contanto que ainda sobrem alternativas suficientes, senão o remédio
 * esconderia a agenda inteira de um dia magro.
 */

/** Minuto do rótulo "HH:mm". Devolve -1 quando o formato não é esse. */
function minutoDe(label: string): number {
  const minuto = Number(label.slice(3, 5));
  return Number.isFinite(minuto) ? minuto : -1;
}

/** Aplica a regra a uma lista de rótulos e devolve os que ficam de pé. */
export function afinarHorarios<T>(itens: T[], rotuloDe: (item: T) => string): T[] {
  if (itens.length <= 20) return itens;
  const grossos = itens.filter((item) => minutoDe(rotuloDe(item)) % 30 === 0);
  return grossos.length >= 8 ? grossos : itens;
}

/**
 * Quantos chips sobram para um dia, sem precisar da lista inteira.
 *
 * É o que a fita de dias anuncia. Recebe os rótulos distintos daquele dia — o
 * servidor já os tem quando monta a contagem — e devolve o mesmo número que a
 * grade vai desenhar.
 */
export function quantosHorariosVisiveis(rotulos: string[]): number {
  return afinarHorarios(rotulos, (r) => r).length;
}
