import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas da página pública.
 *
 * A primeira delas pega uma falha que não produz erro nenhum: `getSession()`
 * chama `cookies()`, o que tira a rota do cache estático em Next 16. O
 * `export const revalidate` vira decoração e a página com mais tráfego e menos
 * motivo para tocar o banco passa a fazer duas consultas por visita anônima.
 * Não há warning, não há erro de build — só a conta do banco subindo.
 */

const RAIZ = process.cwd();

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
    else if (/\.(tsx?|jsx?)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const MARKETING = arquivos(join(RAIZ, "src/app/(marketing)")).filter(
  (f) => !f.endsWith("marketing.test.ts"),
);
const COMPONENTES = arquivos(join(RAIZ, "src/components/marketing"));

describe("landing pública", () => {
  it("não consulta a sessão em lugar nenhum", () => {
    const culpados = [...MARKETING, ...COMPONENTES].filter((f) => {
      const src = readFileSync(f, "utf8");
      return /\bgetSession\b|\brequireSession\b|from ["']@\/server\/auth["']/.test(src);
    });

    expect(
      culpados.map((f) => f.replace(`${RAIZ}/`, "")),
      "Consultar a sessão tira a landing do cache estático: o revalidate vira " +
        "decoração e cada visita anônima passa a custar consulta ao banco.",
    ).toEqual([]);
  });

  it("declara revalidação na página", () => {
    const page = readFileSync(join(RAIZ, "src/app/(marketing)/page.tsx"), "utf8");
    expect(page).toMatch(/export const revalidate\s*=\s*\d+/);
  });

  it("não usa os tokens claros do produto em superfície escura", () => {
    // bg-surface e text-ink existem para o app. Na landing eles produzem
    // texto escuro sobre fundo escuro, e o erro só aparece a olho nu.
    const culpados: string[] = [];
    for (const f of [...MARKETING, ...COMPONENTES]) {
      const src = readFileSync(f, "utf8");
      // A moldura do print é a exceção legítima: por dentro ela é o app claro.
      const semExcecoes = src.replace(/rounded-\[12px\] bg-surface/g, "");
      if (/\b(text-ink|text-ink-secondary|text-ink-tertiary|bg-surface-raised)\b/.test(semExcecoes)) {
        culpados.push(f.replace(`${RAIZ}/`, ""));
      }
    }
    expect(culpados).toEqual([]);
  });
});
