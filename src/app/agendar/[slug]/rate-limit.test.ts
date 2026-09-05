import { beforeEach, describe, expect, it } from "vitest";
import {
  VISITAS_POR_MINUTO_NA_PLATAFORMA,
  VISITAS_POR_MINUTO_POR_IP,
  _resetarJanelaDeVisitas,
  permitirVisita,
} from "./rate-limit";

/**
 * O freio da única escrita anônima do produto.
 *
 * A página pública gravava uma linha por visita, sem sessão e sem teto: quem
 * sorteia um `visitorToken` novo a cada chamada escreve o quanto quiser, e o
 * `onConflictDoNothing` (que só cobre o mesmo navegador no mesmo dia) não vê
 * nada de errado nisso.
 */
describe("limite de visitas da agenda pública", () => {
  beforeEach(() => {
    _resetarJanelaDeVisitas();
  });

  it("deixa passar até o teto e barra o excedente do mesmo endereço", () => {
    const agora = Date.now();
    for (let i = 0; i < VISITAS_POR_MINUTO_POR_IP; i += 1) {
      expect(permitirVisita("1.2.3.4:salao", agora)).toBe(true);
    }
    expect(permitirVisita("1.2.3.4:salao", agora)).toBe(false);
  });

  it("não deixa um endereço abusivo derrubar a agenda de outra conta", () => {
    const agora = Date.now();
    for (let i = 0; i < VISITAS_POR_MINUTO_POR_IP + 5; i += 1) permitirVisita("1.2.3.4:salao-a", agora);
    // Conta diferente é chave diferente: o teto é por par endereço+agenda.
    expect(permitirVisita("1.2.3.4:salao-b", agora)).toBe(true);
    // E outro visitante da mesma agenda continua entrando.
    expect(permitirVisita("9.9.9.9:salao-a", agora)).toBe(true);
  });

  it("libera de novo no minuto seguinte", () => {
    const agora = Date.now();
    for (let i = 0; i < VISITAS_POR_MINUTO_POR_IP; i += 1) permitirVisita("1.2.3.4:salao", agora);
    expect(permitirVisita("1.2.3.4:salao", agora)).toBe(false);
    expect(permitirVisita("1.2.3.4:salao", agora + 60_000)).toBe(true);
  });

  it("segura quem troca de endereço a cada chamada", () => {
    const agora = Date.now();
    let aceitas = 0;
    // Limite por IP sozinho não veria problema nenhum aqui: cada requisição
    // vem de um endereço diferente e gasta uma única unidade do teto dele.
    for (let i = 0; i < VISITAS_POR_MINUTO_NA_PLATAFORMA + 200; i += 1) {
      if (permitirVisita(`10.0.${Math.floor(i / 250)}.${i % 250}:salao`, agora)) aceitas += 1;
    }
    expect(aceitas).toBe(VISITAS_POR_MINUTO_NA_PLATAFORMA);
  });

  it("a recusa não empurra a contagem para frente", () => {
    const agora = Date.now();
    for (let i = 0; i < VISITAS_POR_MINUTO_POR_IP; i += 1) permitirVisita("1.2.3.4:salao", agora);
    for (let i = 0; i < 50; i += 1) expect(permitirVisita("1.2.3.4:salao", agora)).toBe(false);
    // Insistir não consumiu a cota da plataforma, que continua livre para
    // quem está apenas abrindo a agenda.
    expect(permitirVisita("5.6.7.8:salao", agora)).toBe(true);
  });
});
