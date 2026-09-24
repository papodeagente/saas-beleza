/**
 * CPF, CEP e cartão: o que a tela precisa para não deixar a cliente errar.
 *
 * Mora no domínio porque o mesmo par de regras vale nos dois lados: a tela
 * formata e barra na hora, e o servidor confere de novo antes de falar com o
 * Asaas. Duplicar essa conta em dois lugares acabaria em campo que passa no
 * navegador e é recusado pelo gateway, com a cliente no meio.
 */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * CPF válido de verdade, com os dois dígitos verificadores.
 *
 * Vale a conta local porque o Asaas recusa CPF inválido com uma frase genérica
 * DEPOIS de a cliente digitar o cartão inteiro. Barrar no campo custa nada e
 * evita a pior versão do erro: a que aparece no fim.
 */
export function cpfValido(entrada: string): boolean {
  const cpf = somenteDigitos(entrada);
  if (cpf.length !== 11) return false;
  // Sequência repetida passa na conta dos dígitos e não é CPF de ninguém.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (const [tamanho, posicao] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (posicao - i);
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

export function formatarCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatarCep(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Grupos de quatro. Cartão de 19 dígitos (Elo, Hipercard) também cabe. */
export function formatarNumeroDoCartao(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 19);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function formatarValidade(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/**
 * Luhn.
 *
 * Pega dígito trocado e dois dígitos invertidos, que é o erro de digitação de
 * cartão mais comum. Não diz que o cartão existe nem que tem limite: diz que
 * não vale gastar uma tentativa no gateway com um número impossível.
 */
export function numeroDeCartaoPlausivel(entrada: string): boolean {
  const numero = somenteDigitos(entrada);
  if (numero.length < 13 || numero.length > 19) return false;
  let soma = 0;
  let dobra = false;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let digito = Number(numero[i]);
    if (dobra) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

export type ValidadeDoCartao = { mes: string; ano: string };

/**
 * "07/27" vira { mes: "07", ano: "2027" }.
 *
 * O Asaas quer o ano com quatro dígitos, e cartão vencido ele recusa com a
 * mensagem do adquirente, que chega depois. `agora` é parâmetro para o teste
 * não depender do calendário de quem roda.
 */
export function lerValidade(valor: string, agora = new Date()): ValidadeDoCartao | null {
  const d = somenteDigitos(valor);
  if (d.length !== 4) return null;
  const mes = Number(d.slice(0, 2));
  if (mes < 1 || mes > 12) return null;

  const ano = 2000 + Number(d.slice(2));
  // Último instante do mês: cartão vale até o fim do mês impresso nele.
  const fim = new Date(Date.UTC(ano, mes, 1));
  if (fim <= agora) return null;

  return { mes: d.slice(0, 2), ano: String(ano) };
}

export type BandeiraDoCartao =
  | "Visa"
  | "Mastercard"
  | "Elo"
  | "American Express"
  | "Hipercard"
  | "Diners Club";

/**
 * Faixas da Elo.
 *
 * Ficam numa lista porque a Elo NÃO tem um prefixo próprio: ela ocupa faixas
 * emitidas dentro do espaço da Visa (começa com 4) e do Mastercard (começa com
 * 5). Testar "começa com 4 logo é Visa" antes daqui erra a bandeira de cartão
 * Elo brasileiro, que é justamente o mais comum num salão.
 */
const FAIXAS_ELO = [
  "401178", "401179", "431274", "438935", "451416", "457393", "457631", "457632",
  "504175", "627780", "636297", "636368",
];

const INTERVALOS_ELO: [number, number][] = [
  [506699, 506778],
  [509000, 509999],
  [650031, 650033],
  [650035, 650051],
  [650405, 650439],
  [650485, 650538],
  [650541, 650598],
  [650700, 650718],
  [650720, 650727],
  [650901, 650978],
  [651652, 651679],
  [655000, 655019],
  [655021, 655058],
];

/**
 * A bandeira, só para a tela mostrar que reconheceu o cartão.
 *
 * É devolução visual, não validação: quem autoriza é o adquirente. Serve para
 * quem está digitando ver que o número está indo para o lugar certo, que é o
 * que as plataformas grandes fazem — e o que tira a sensação de estar jogando
 * o cartão num formulário qualquer.
 */
export function bandeiraDoCartao(entrada: string): BandeiraDoCartao | null {
  const n = somenteDigitos(entrada);
  if (n.length < 4) return null;

  // Elo e Hipercard primeiro: moram dentro das faixas da Visa e do Mastercard.
  const seis = n.slice(0, 6);
  if (FAIXAS_ELO.includes(seis)) return "Elo";
  if (n.length >= 6) {
    const numero = Number(seis);
    if (INTERVALOS_ELO.some(([de, ate]) => numero >= de && numero <= ate)) return "Elo";
  }
  if (seis === "606282" || n.startsWith("3841")) return "Hipercard";

  if (/^3[47]/.test(n)) return "American Express";
  if (/^(30[0-5]|36|38)/.test(n)) return "Diners Club";
  if (n.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  // Mastercard novo, faixa 2221-2720.
  if (n.length >= 4) {
    const quatro = Number(n.slice(0, 4));
    if (quatro >= 2221 && quatro <= 2720) return "Mastercard";
  }
  return null;
}
