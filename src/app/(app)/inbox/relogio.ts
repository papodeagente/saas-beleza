import { diasDeCalendarioEmTz, formatTz } from "@/lib/tz";

/**
 * Os rótulos de tempo do Inbox, fora do componente para poderem ser provados.
 *
 * Toda conta aqui é feita no fuso do SALÃO, e não no de quem está renderizando.
 * A primeira pintura sai do servidor, que em produção roda em UTC: uma mensagem
 * das 22:30 de terça em Natal é quarta-feira 01:30 para ele. A tela escrevia
 * 01:30 e depois trocava para 22:30 quando o navegador assumia — quando trocava,
 * porque a bolha da mensagem tinha `suppressHydrationWarning` e o número errado
 * simplesmente ficava.
 *
 * `agora` é parâmetro para o teste poder fixar o instante. Em tela é sempre o
 * relógio de verdade.
 */

/**
 * Quando a conversa falou pela última vez, na régua de todo aplicativo de
 * mensagem: hora absoluta hoje, dia da semana na semana corrente, data depois.
 *
 * "há 13 h" obriga a fazer conta para saber se foi antes ou depois do almoço — e
 * a atendente precisa exatamente disso para decidir o que responder primeiro.
 */
export function horaDaLista(iso: string, fuso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  const dias = diasDeCalendarioEmTz(agora, data, fuso);
  // `<= 0` e não `=== 0`: mensagem com carimbo alguns segundos à frente do
  // relógio local (o provedor carimba, nós não) daria -1 e cairia em "dd/MM".
  if (dias <= 0) return formatTz(data, fuso, "HH:mm");
  if (dias === 1) return "Ontem";
  if (dias < 7) return formatTz(data, fuso, "EEEEEE");
  return formatTz(data, fuso, "dd/MM");
}

/**
 * A pílula de data entre as bolhas. Sem ela, uma mensagem das 19:53 era seguida
 * de outra das 08:46 sem nada no meio, e a conversa parecia ter acontecido em
 * minutos.
 */
export function rotuloDoSeparador(iso: string, fuso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  const dias = diasDeCalendarioEmTz(agora, data, fuso);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return formatTz(data, fuso, "d 'de' MMMM");
}
