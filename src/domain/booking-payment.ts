/**
 * A conta do sinal da reserva.
 *
 * Mora no domínio, e não no serviço, porque a TELA precisa da mesma conta: a
 * configuração de pagamentos mostra "num serviço de R$ 120, a cliente paga R$
 * 60 agora". Duplicar a fórmula no cliente é assinar a promessa de que um dia
 * a tela vai prometer um valor e o Asaas vai cobrar outro.
 */

/** Mínimo que o Asaas aceita numa cobrança. Abaixo disso ele recusa o link. */
export const MINIMO_ASAAS_CENTS = 500;

/**
 * Quanto entra na reserva.
 *
 * Arredonda para cima: um sinal de 50% sobre R$ 79,90 vira R$ 39,95, e centavo
 * quebrado em cobrança é confusão na conciliação.
 *
 * Sobe até o mínimo de R$ 5,00 do Asaas, mas **nunca passa do preço do
 * serviço**: a ordem das duas travas importa. Com o piso aplicado por último,
 * um serviço de R$ 3,00 com sinal de 100% cobraria R$ 5,00 — a cliente pagaria
 * mais que o atendimento inteiro. Serviço mais barato que o mínimo do Asaas
 * simplesmente não tem como ser cobrado; quem decide o que fazer nesse caso é
 * `abrirCobranca`, que agenda sem cobrança em vez de travar a agenda.
 */
export function valorDaReserva(precoCents: number, percentual: number): number {
  const bruto = Math.ceil((precoCents * percentual) / 100);
  return Math.min(Math.max(MINIMO_ASAAS_CENTS, bruto), precoCents);
}
