import { headers } from "next/headers";
import { permitirAgendamento, permitirConsulta } from "@/app/agendar/[slug]/rate-limit";
import { clientIp } from "@/server/services/signup";

/**
 * A API do marketplace.
 *
 * Existe porque Server Action não é contrato: o cliente de uma action é o
 * cabeçalho `Next-Action` com um id gerado no build, que muda a cada deploy.
 * Um aplicativo nativo não consegue chamar isso — e o produto está sendo
 * construído para virar aplicativo.
 *
 * Então toda leitura pública do diretório passa por aqui, em JSON estável, e a
 * web consome as MESMAS funções de serviço que estas rotas consomem. Não há
 * duas implementações da busca: há uma, com duas portas.
 *
 * TODAS as rotas são anônimas, então todas passam pelo mesmo limitador das
 * ações públicas do agendamento — ver o comentário de teto em
 * `src/app/agendar/[slug]/rate-limit.ts`, onde está a conta de quanto custa uma
 * varredura de disponibilidade.
 */

export function json(dados: unknown, init?: ResponseInit): Response {
  return Response.json(dados, {
    ...init,
    headers: {
      // O diretório é público e pensado para ser consumido por app: o CORS
      // aberto é intencional, e é seguro porque não há sessão nem cookie nestas
      // rotas — não existe nada para um site terceiro sequestrar.
      "access-control-allow-origin": "*",
      ...init?.headers,
    },
  });
}

export function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, { status });
}

/** Chave do limitador. Sem salão dono da consulta, a chave é o endereço. */
async function chave(sufixo: string): Promise<string> {
  return `${clientIp(await headers())}:${sufixo}`;
}

/** Leituras: busca, cidades, perfil, horários. */
export async function podeConsultar(sufixo = "api-marketplace"): Promise<boolean> {
  return permitirConsulta(await chave(sufixo));
}

/** Escrita: fechar um agendamento. Teto mais baixo dos três. */
export async function podeAgendar(slug: string): Promise<boolean> {
  return permitirAgendamento(await chave(slug));
}

/** Número de query string que aceita ausência sem virar zero. */
export function numeroDe(url: URL, chave: string): number | undefined {
  const bruto = url.searchParams.get(chave);
  if (!bruto) return undefined;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : undefined;
}
