/**
 * Aritmética de calendário do agendamento público.
 *
 * Vive fora do componente por dois motivos. O primeiro é teste: "que dia cai na
 * primeira célula da grade de setembro" é uma pergunta com resposta certa, e
 * errar por um dia desloca o mês inteiro sem que nada quebre na tela — o tipo
 * de defeito que só a cliente encontra. O segundo é que a mesma conta decide o
 * que vai ser PEDIDO ao servidor: a grade tem 42 células e o mês tem 31 dias, e
 * consultar as 42 estoura o limite de 31 da ação.
 *
 * Tudo aqui trabalha em UTC e devolve `yyyy-MM-dd`. Não há relógio nenhum
 * nestas contas — só a sequência dos dias do calendário — e fazer a soma no
 * fuso local traz junto o horário de verão, que faz "somar um dia" cair no
 * mesmo dia de novo na madrugada da virada.
 */

/** Um dia da grade. `null` é célula de mês vizinho, que a grade mostra vazia. */
export type Celula = string | null;

const emDias = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const paraISO = (data: Date) => data.toISOString().slice(0, 10);

/** "2026-08-28" -> "2026-08" */
export function mesDe(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Soma dias a uma data ISO, sem passar por fuso. */
export function somarDias(dateISO: string, dias: number): string {
  const data = emDias(dateISO);
  data.setUTCDate(data.getUTCDate() + dias);
  return paraISO(data);
}

/**
 * Soma meses a um mês ISO.
 *
 * `setUTCMonth` sobre o dia 1º é seguro: é o único dia que existe em todo mês.
 * A partir do dia 31, "mais um mês" cai no dia 3 de março — e a navegação
 * pularia fevereiro inteiro.
 */
export function somarMeses(mesISO: string, delta: number): string {
  const [ano, mes] = mesISO.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 + delta, 1));
  return paraISO(data).slice(0, 7);
}

/** Quantos dias tem o mês. */
export function diasNoMes(mesISO: string): number {
  const [ano, mes] = mesISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * As 42 células da grade, domingo a sábado, seis semanas.
 *
 * Seis semanas SEMPRE, mesmo quando cinco bastariam. A altura da grade é o que
 * segura o painel de horários ao lado dela: com o número de linhas variando por
 * mês, avançar de novembro para dezembro empurra a página inteira meio
 * centímetro para baixo, e o dedo que já estava indo para um horário erra o
 * alvo.
 */
export function gradeDoMes(mesISO: string): Celula[] {
  const primeiro = emDias(`${mesISO}-01`);
  const total = diasNoMes(mesISO);
  const vazioAntes = primeiro.getUTCDay();
  return Array.from({ length: 42 }, (_, i) => {
    const dia = i - vazioAntes + 1;
    return dia >= 1 && dia <= total
      ? `${mesISO}-${String(dia).padStart(2, "0")}`
      : null;
  });
}

/**
 * Os dias DESTE mês que vale a pena perguntar ao servidor: nem os que já
 * passaram, nem os além do horizonte do serviço. São no máximo 31, que é
 * exatamente o teto da ação pública.
 */
export function diasConsultaveis(
  mesISO: string,
  hojeISO: string,
  ultimoISO: string,
): string[] {
  return gradeDoMes(mesISO).filter(
    (dia): dia is string => dia !== null && dia >= hojeISO && dia <= ultimoISO,
  );
}

/**
 * De que mês até que mês a cliente pode navegar.
 *
 * O fim vem do `maxLeadDays` do serviço — que nesta base vai de 45 a 120 dias,
 * e não é enfeite: passar dele é bater num mês que o servidor NUNCA vai
 * responder com vaga nenhuma. Mês vazio por regra lê como agenda lotada.
 */
export function limitesDeNavegacao(hojeISO: string, maxLeadDays: number) {
  const ultimoISO = somarDias(hojeISO, maxLeadDays);
  return {
    primeiroMes: mesDe(hojeISO),
    ultimoMes: mesDe(ultimoISO),
    ultimoISO,
  };
}

/**
 * Que mês deve ficar visível depois que o servidor respondeu.
 *
 * Quem abre a página no dia 30 cai num mês que tem um ou nenhum dia livre, e
 * uma grade de agosto vazia diz "lotado" quando setembro está inteiro em
 * aberto. Por isso a página avança sozinha — UMA vez, e só no carregamento
 * inicial (`podeAvancar`). Dois saltos automáticos já seriam a página decidindo
 * sozinha para onde a cliente estava olhando, e o segundo aconteceria depois de
 * ela já ter visto o primeiro.
 *
 * Nunca passa do último mês agendável: lá o vazio é a resposta certa, e existe
 * uma frase na tela para ele.
 */
export function mesAAbrir(
  mesPedido: string,
  diasLivres: number,
  podeAvancar: boolean,
  ultimoMes: string,
): string {
  const vazioEHaParaOnde =
    diasLivres === 0 && podeAvancar && mesPedido < ultimoMes;
  return vazioEHaParaOnde ? somarMeses(mesPedido, 1) : mesPedido;
}
