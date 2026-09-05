import { describe, expect, it } from "vitest";
import { esmalteDe, lacaDe } from "./esmaltes";

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
/** As superfícies da vitrine, onde a postiça de fato pousa. */
const CARTAO_OSSO = "#fbf7f2";
const REBAIXADO = "#f4ece1";
const BALCAO = "#eee4d7";
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

  it("mantém o aro acima de 3:1 em toda superfície onde a postiça pousa", () => {
    // É o limiar de contorno de componente (WCAG 1.4.11). Sem ele o nude
    // (1,36:1 sobre branco) simplesmente some da tela. As três superfícies de
    // osso entraram quando o chão da página deixou de ser lavanda: dois aros
    // que passavam no branco reprovavam no balcão.
    const superficies: Array<[string, string]> = [
      ["o cartão branco", CARTAO],
      ["o canvas", CANVAS],
      ["o cartão de osso", CARTAO_OSSO],
      ["a placa rebaixada", REBAIXADO],
      ["o balcão", BALCAO],
    ];
    for (const categoria of CATEGORIAS) {
      const { nome, aro } = esmalteDe(categoria);
      for (const [onde, fundo] of superficies) {
        expect(razao(aro, fundo), `${nome} sobre ${onde}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("distribui os tons em vez de despejar tudo num só", () => {
    const tons = new Set(CATEGORIAS.map((c) => esmalteDe(c).nome));
    expect(tons.size).toBeGreaterThanOrEqual(4);
  });
});

/**
 * A laca da casa.
 *
 * O plano do cabeçalho ocupa o topo inteiro da página e carrega o nome da
 * clínica em branco. Um tom claro demais nesse conjunto não deixa a tela feia:
 * deixa o nome do salão ilegível para quem abriu o link.
 */
describe("laca da casa", () => {
  const CASAS = ["Clínica Lumina", "ENTUR", "Studio Bella Mão", "Espaço Nails", "Ateliê da Rê", ""];

  it("é a mesma para toda clínica, e não um sorteio", () => {
    // A versão sorteada por hash caiu num marrom-café na primeira clínica
    // testada. Cor que a dona não escolheu e não pode corrigir é risco, não
    // personalidade.
    const primeira = lacaDe(CASAS[0]);
    for (const casa of CASAS) expect(lacaDe(casa)).toEqual(primeira);
    expect(lacaDe(null)).toEqual(primeira);
    expect(lacaDe(undefined)).toEqual(primeira);
  });

  it("mantém branco chapado acima de 12:1", () => {
    for (const casa of CASAS) {
      const { nome, tinta } = lacaDe(casa);
      expect(razao("#ffffff", tinta), `branco sobre ${nome}`).toBeGreaterThanOrEqual(12);
    }
  });

  it("mantém o texto secundário acima de 4,5:1 mesmo com a laca clareada", () => {
    // As três camadas de brilho da utility `laca` CLAREIAM o fundo. O pior
    // empilhamento medido clareia ~20%, e é contra ele que o endereço e o
    // telefone — branco a 80% — precisam sobreviver.
    const clarear = (hex: string, fator: number) => {
      const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const misturado = canais.map((c) => Math.round(c + (255 - c) * fator));
      return `#${misturado.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    };
    const sobre = (fg: number[], bg: string, alfa: number) => {
      const canais = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
      const c = fg.map((v, i) => Math.round(v * alfa + canais[i] * (1 - alfa)));
      return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const casa of CASAS) {
      const { nome, tinta } = lacaDe(casa);
      const clara = clarear(tinta, 0.2);
      const texto = sobre([255, 255, 255], clara, 0.8);
      expect(razao(texto, clara), `branco 80% sobre ${nome} clareada`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
