"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { cpfValido, lerValidade, numeroDeCartaoPlausivel } from "@/domain/documento";
import { AsaasError } from "@/server/payments/asaas";
import {
  CheckoutError,
  type PixParaPagar,
  cobrarComCartao,
  cobrarComPix,
  sincronizarPagamento,
} from "@/server/services/booking-payment-service";
import { clientIp } from "@/server/services/signup";
import {
  permitirAgendamento,
  permitirConsultaDePagamento,
} from "../../agendar/[slug]/rate-limit";

/**
 * O checkout da cliente, sem sessão.
 *
 * Quem paga não tem login: o token da reserva é a autorização, e o limite de
 * vazão é a única outra barreira. Por isso toda ação aqui começa pelo freio —
 * criar cobrança é escrita nossa MAIS chamada ao Asaas, e é o tipo de rota que
 * alguém varre se não tiver teto.
 *
 * As mensagens de erro são escritas para a cliente ler no meio de um
 * pagamento: dizem o que fazer, nunca o que falhou por dentro.
 */

export type ResultadoPix = { ok: true; pix: PixParaPagar } | { ok: false; erro: string };
export type ResultadoCartao = { ok: true; pago: boolean } | { ok: false; erro: string };

async function freio(): Promise<string> {
  return clientIp(await headers());
}

/**
 * Traduz a falha para quem está com o celular na mão.
 *
 * `CheckoutError` já é texto para a cliente. `AsaasError` carrega a frase do
 * adquirente ("Transação não autorizada"), que é a única informação útil numa
 * recusa de cartão. O resto vira uma frase neutra: erro interno não é assunto
 * de quem está pagando.
 */
function explicar(erro: unknown): string {
  if (erro instanceof CheckoutError) return erro.message;
  if (erro instanceof AsaasError) return erro.message;
  console.error("[checkout] falha:", erro instanceof Error ? erro.message : erro);
  return "Não consegui concluir agora. Tente de novo em alguns instantes.";
}

const tokenSchema = z.string().trim().min(24).max(120);

const pixSchema = z.object({
  token: tokenSchema,
  cpf: z.string().trim().min(11).max(20),
});

export async function gerarPixAction(entrada: unknown): Promise<ResultadoPix> {
  try {
    if (!permitirAgendamento(await freio())) {
      return { ok: false, erro: "Muitas tentativas seguidas. Espere um minuto e tente de novo." };
    }
    const dados = pixSchema.parse(entrada);
    if (!cpfValido(dados.cpf)) return { ok: false, erro: "Confira o CPF: os números não fecham." };

    return { ok: true, pix: await cobrarComPix(dados.token, dados.cpf) };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

const cartaoSchema = z.object({
  token: tokenSchema,
  numero: z.string().trim().min(13).max(30),
  nomeImpresso: z.string().trim().min(2).max(100),
  validade: z.string().trim().min(4).max(7),
  cvv: z.string().trim().min(3).max(4),
  cpf: z.string().trim().min(11).max(20),
  email: z.string().trim().email().max(120),
  cep: z.string().trim().min(8).max(12),
  numeroDoEndereco: z.string().trim().min(1).max(10),
});

/**
 * Cobra no cartão.
 *
 * Os dados do cartão entram aqui, seguem para o Asaas e não são gravados em
 * lugar nenhum: nem em coluna, nem em log. Nenhum `console.log` desta ação
 * imprime a entrada — é a regra que mantém o cartão fora do disco.
 */
export async function pagarComCartaoAction(entrada: unknown): Promise<ResultadoCartao> {
  try {
    if (!permitirAgendamento(await freio())) {
      return { ok: false, erro: "Muitas tentativas seguidas. Espere um minuto e tente de novo." };
    }
    const dados = cartaoSchema.parse(entrada);

    if (!cpfValido(dados.cpf)) return { ok: false, erro: "Confira o CPF: os números não fecham." };
    if (!numeroDeCartaoPlausivel(dados.numero)) {
      return { ok: false, erro: "Confira o número do cartão." };
    }
    const validade = lerValidade(dados.validade);
    if (!validade) return { ok: false, erro: "Confira a validade do cartão." };

    const resultado = await cobrarComCartao(
      dados.token,
      {
        cartao: {
          numero: dados.numero,
          nomeImpresso: dados.nomeImpresso,
          mes: validade.mes,
          ano: validade.ano,
          cvv: dados.cvv,
        },
        cpf: dados.cpf,
        email: dados.email,
        cep: dados.cep,
        numeroDoEndereco: dados.numeroDoEndereco,
      },
      await freio(),
    );
    return { ok: true, pago: resultado.pago };
  } catch (erro) {
    return { ok: false, erro: explicar(erro) };
  }
}

/**
 * A tela do PIX pergunta por aqui se o dinheiro entrou.
 *
 * Recusa do freio devolve `pago: false`, igual a "ainda não caiu": a tela
 * pergunta de novo no próximo tique. Transformar limite de vazão em "não
 * pagou" seria a pior mentira possível nesta tela.
 */
export async function conferirPagamentoAction(entrada: unknown): Promise<{ pago: boolean }> {
  try {
    if (!permitirConsultaDePagamento(await freio())) return { pago: false };
    const token = tokenSchema.parse(entrada);
    return await sincronizarPagamento(token);
  } catch (erro) {
    console.error("[checkout] consulta falhou:", erro instanceof Error ? erro.message : erro);
    return { pago: false };
  }
}
