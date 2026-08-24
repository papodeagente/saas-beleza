import { describe, expect, it } from "vitest";
import { esmalteDe } from "./esmaltes";

/** Razão de contraste WCAG entre dois hex opacos. */
function razao(a: string, b: string): number {
  const luz = (hex: string) => {
    const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luz(a), luz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const CARTAO = "#ffffff";
const CANVAS = "#f8f6fb";
const CATEGORIAS = [
  "Unha em gel",
  "Alongamento",
  "Esmaltação",
  "Spa dos pés",
  "Manutenção",
  "Nail art",
  "Cutilagem",
  "Blindagem",
  "Banho de gel",
  null,
];

describe("cartela de esmaltes", () => {
  it("dá sempre o mesmo tom para a mesma categoria", () => {
    // A gota é renderizada no servidor e de novo na hidratação: um sorteio aqui
    // viraria divergência de marcação, além de trocar de cor a cada visita.
    for (const categoria of CATEGORIAS) {
      expect(esmalteDe(categoria)).toEqual(esmalteDe(categoria));
    }
  });

  it("trata categoria ausente sem cair no vazio", () => {
    expect(esmalteDe(null).fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(esmalteDe(undefined)).toEqual(esmalteDe(null));
    expect(esmalteDe("")).toEqual(esmalteDe(null));
  });

  it("mantém o aro acima de 3:1 contra o cartão E contra o canvas", () => {
    // É o limiar de contorno de componente (WCAG 1.4.11). Sem ele o nude
    // (1,36:1 sobre branco) simplesmente some da tela.
    for (const categoria of CATEGORIAS) {
      const { nome, aro } = esmalteDe(categoria);
      expect(razao(aro, CARTAO), `${nome} sobre o cartão`).toBeGreaterThanOrEqual(3);
      expect(razao(aro, CANVAS), `${nome} sobre o canvas`).toBeGreaterThanOrEqual(3);
    }
  });

  it("distribui os tons em vez de despejar tudo num só", () => {
    const tons = new Set(CATEGORIAS.map((c) => esmalteDe(c).nome));
    expect(tons.size).toBeGreaterThanOrEqual(4);
  });
});
