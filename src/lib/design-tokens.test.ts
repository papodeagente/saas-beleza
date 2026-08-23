import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

/**
 * O porteiro do sistema de tokens.
 *
 * Existe porque a falha que ele pega não aparece em lugar nenhum: se um
 * `text-*` novo entra em globals.css sem entrar na lista do tailwind-merge, o
 * twMerge o classifica como COR e descarta silenciosamente a classe irmã. Não
 * há erro de build, de tipo nem de lint — só um título renderizando em 14px, ou
 * um botão perdendo a cor do texto. Já aconteceu uma vez, com o botão primário
 * saindo em 2:1 de contraste.
 *
 * Documentação não protege disso. Teste protege.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const UTILS = readFileSync(join(process.cwd(), "src/lib/utils.ts"), "utf8");

/** Nomes declarados como escala tipográfica: `--text-<nome>:` e `@utility text-<nome>`. */
function nomesDeTextoNoCss(): string[] {
  const nomes = new Set<string>();
  for (const m of CSS.matchAll(/--text-([a-z-]+):/g)) {
    // `--text-hero--line-height` declara o modificador, não um nome novo.
    if (!m[1].includes("--")) nomes.add(m[1]);
  }
  for (const m of CSS.matchAll(/@utility\s+text-([a-z-]+)\s*\{/g)) nomes.add(m[1]);
  return [...nomes].sort();
}

describe("escala tipográfica", () => {
  it("todo text-* do CSS está registrado no tailwind-merge", () => {
    const registrados = new Set(
      [...UTILS.matchAll(/^\s*"([a-z-]+)",\s*$/gm)].map((m) => m[1]),
    );
    const faltando = nomesDeTextoNoCss().filter((n) => !registrados.has(n));

    expect(
      faltando,
      `Estes tamanhos de texto existem no CSS mas não estão na lista de "font-size" ` +
        `em src/lib/utils.ts. O twMerge vai tratá-los como cor e descartar classes: ` +
        `${faltando.join(", ")}`,
    ).toEqual([]);
  });

  it("tamanho e cor sobrevivem juntos, nas duas ordens", () => {
    // A ordem importa: registrado errado, uma ordem perde o tamanho e a outra
    // perde a cor. Testamos as duas.
    for (const size of ["text-hero", "text-section-title", "text-lede", "text-eyebrow", "text-stat"]) {
      expect(cn(size, "text-night-ink")).toContain(size);
      expect(cn(size, "text-night-ink")).toContain("text-night-ink");
      expect(cn("text-night-ink", size)).toContain(size);
      expect(cn("text-night-ink", size)).toContain("text-night-ink");
    }
  });

  it("a landing não redefine nenhum token do produto", () => {
    // Redefinir --color-surface/ink/accent sob escopo recoloriria todo
    // componente compartilhado renderizado dentro da landing, em silêncio.
    const redefinicoes = [...CSS.matchAll(/\[data-surface="night"\][^{]*\{([^}]*)\}/g)]
      .flatMap((m) => [...m[1].matchAll(/(--color-(?:surface|ink|accent|line)[a-z-]*)\s*:/g)])
      .map((m) => m[1]);

    expect(
      redefinicoes,
      `A landing redefiniu tokens do produto sob escopo: ${redefinicoes.join(", ")}. ` +
        `Ela só pode ADICIONAR nomes (night-*, accent-lift), nunca sobrescrever os existentes.`,
    ).toEqual([]);
  });
});
