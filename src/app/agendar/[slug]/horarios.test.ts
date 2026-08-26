import { describe, expect, it } from "vitest";
import { afinarHorarios, quantosHorariosVisiveis } from "./horarios";

/**
 * O número que a fita de dias fala e o número de chips que a grade desenha
 * PRECISAM ser o mesmo. Já não eram: a mesma tela anunciava 31 horários livres
 * e oferecia 16, e quem usa leitor de tela ouvia os dois.
 */

const doZeroAte = (n: number, passo: number) =>
  Array.from({ length: n }, (_, i) => {
    const minutos = 9 * 60 + i * passo;
    return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
  });

describe("afinar horários", () => {
  it("não mexe em agenda curta", () => {
    const curta = doZeroAte(12, 30);
    expect(afinarHorarios(curta, (r) => r)).toEqual(curta);
  });

  it("dobra o passo quando o muro passa de vinte opções", () => {
    // 31 instantes de 15 em 15 a partir das 09:00 → só os :00 e :30.
    const densa = doZeroAte(31, 15);
    const vistos = afinarHorarios(densa, (r) => r);
    expect(vistos.length).toBe(16);
    expect(vistos.every((r) => Number(r.slice(3, 5)) % 30 === 0)).toBe(true);
  });

  it("desiste de afinar quando sobraria quase nada", () => {
    // Dia magro com 21 horários todos quebrados (:10, :25…): afinar deixaria
    // a cliente sem opção nenhuma, e aí é melhor o muro do que a parede.
    const quebrados = Array.from({ length: 21 }, (_, i) => `1${i % 10}:1${i % 5}`);
    expect(afinarHorarios(quebrados, (r) => r).length).toBe(21);
  });

  it("a contagem anunciada é a contagem desenhada", () => {
    for (const [quantos, passo] of [[31, 15], [12, 30], [40, 15], [8, 60]] as const) {
      const rotulos = doZeroAte(quantos, passo);
      expect(quantosHorariosVisiveis(rotulos)).toBe(afinarHorarios(rotulos, (r) => r).length);
    }
  });
});
