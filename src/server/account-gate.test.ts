import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas do portão de acesso (teste vencido, cancelamento, suspensão).
 *
 * São verificações estruturais porque a falha que elas pegam não produz erro
 * nenhum: com o portão apenas no layout de `(app)`, a conta bloqueada continua
 * gravando no banco. Layout não roda antes de Server Action — o Next executa a
 * action e SÓ DEPOIS renderiza a árvore, então a escrita já aconteceu quando o
 * redirecionamento chega. Nada disso quebra build, tipo ou teste de unidade: o
 * painel segue funcionando para quem tem acesso, e só o portão fica de enfeite.
 */

const RAIZ = process.cwd();

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.tsx?$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

/**
 * Comentário fora: estes arquivos EXPLICAM o portão, e um teste que lesse a
 * explicação como se fosse código acusaria justamente quem documentou a regra.
 */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("portão de acesso", () => {
  it("é aplicado em requireSession, e não só no layout do painel", () => {
    const auth = semComentarios(ler("src/server/auth.ts"));

    expect(
      /getAccountAccess/.test(auth) && /\/conta\/assinatura/.test(auth),
      "requireSession() é a porta de entrada de TODA Server Action do painel " +
        "(docs/product-architecture.md §5). Sem o portão aqui, uma aba aberta " +
        "quando o teste vence continua criando cliente, atendimento e mensagem.",
    ).toBe(true);
  });

  it("cobre toda Server Action do painel", () => {
    const semSessao = arquivos(join(RAIZ, "src/app/(app)"))
      .filter((f) => /^["']use server["']/.test(readFileSync(f, "utf8").trimStart()))
      .filter((f) => !/\brequireSession\b/.test(semComentarios(readFileSync(f, "utf8"))));

    expect(
      semSessao.map((f) => f.replace(`${RAIZ}/`, "")),
      "Toda action do painel obtém o contexto por requireSession() — é ela que " +
        "carrega o portão. Uma action que resolve o tenant por outro caminho " +
        "escreve no banco de conta bloqueada.",
    ).toEqual([]);
  });

  it("não fecha a própria tela de assinatura em laço", () => {
    const gate = semComentarios(ler("src/app/(billing)/conta/assinatura/page.tsx"));

    expect(
      /\brequireSession\b/.test(gate),
      "A tela do bloqueio precisa continuar usando getSession(): requireSession " +
        "redireciona para ela mesma e a clínica bloqueada não veria tela nenhuma.",
    ).toBe(false);
  });
});
