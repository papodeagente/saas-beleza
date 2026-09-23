/**
 * O identificador do job de turno, e a regra que ele quebrou em produção.
 *
 * O BullMQ RECUSA id personalizado que contenha ":" — é o separador das chaves
 * dele no Redis, e a validação lança `Custom Id cannot contain :`. O id era
 * `conv:<id>`, então TODA tentativa de enfileirar morria: de 16/09 a 23/09
 * entraram 2.043 mensagens em duas contas com o agente ligado e nenhuma
 * resposta saiu, enquanto o webhook devolvia 503 e a uazapi reentregava o mesmo
 * evento.
 *
 * Nenhum teste pegou porque todos trocam a fila por um dublê, e dublê aceita
 * qualquer id. Por isso a regra mora AQUI, num módulo sem Redis e sem BullMQ:
 * é o que permite prová-la em teste de unidade, que é onde ela vai ficar.
 */

/** Caracteres que o BullMQ não aceita em id personalizado. */
const PROIBIDOS = /:/;

export function idDoTurno(conversationId: number, carimbo?: number): string {
  const id = carimbo === undefined ? `conv-${conversationId}` : `conv-${conversationId}-${carimbo}`;
  // Guarda de cinto e suspensório: se algum dia alguém montar o id de outra
  // forma, o erro aparece aqui, com nome, e não como um 503 silencioso no
  // webhook de madrugada.
  if (PROIBIDOS.test(id)) throw new Error(`id de job inválido para o BullMQ: ${id}`);
  return id;
}
