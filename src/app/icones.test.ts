import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O porteiro dos arquivos de ícone.
 *
 * Existe porque a falha que ele pega não aparece em lugar nenhum. O
 * `app-icon-maskable-512.png` deste produto era, byte a byte, uma CÓPIA do
 * `app-icon-512.png` — mesmo SHA1. Ou seja: zona segura zero. A máscara
 * circular do Android cortava os cantos arredondados do ladrilho e mordia a
 * marca, e nada no build, no tipo ou no lint reclamava. Só se vê instalando o
 * PWA num Android e olhando a tela de início.
 *
 * O mesmo vale para o apple-touch-icon: o iOS não respeita transparência, ele
 * pinta de PRETO o que for transparente. Um PNG com alfa vira um ícone com
 * moldura preta no iPhone — e no Mac do desenvolvedor fica perfeito.
 *
 * Nenhum destes testes precisa decodificar imagem: os invariantes foram
 * escolhidos para serem legíveis do cabeçalho do arquivo.
 */

const RAIZ = process.cwd();
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho));
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** IHDR do PNG: largura, altura e tipo de cor moram nos bytes 16..26. */
function cabecalhoPng(b: Buffer) {
  expect(b.subarray(1, 4).toString("ascii"), "assinatura PNG").toBe("PNG");
  return {
    largura: b.readUInt32BE(16),
    altura: b.readUInt32BE(20),
    /** 2 = RGB sem canal alfa · 6 = RGBA */
    tipoDeCor: b.readUInt8(25),
  };
}

/** Diretório do ICO: cabeçalho de 6 bytes e depois 16 bytes por quadro. */
function tamanhosDoIco(b: Buffer): number[] {
  expect(b.readUInt16LE(0), "reservado").toBe(0);
  expect(b.readUInt16LE(2), "tipo (1 = ícone)").toBe(1);
  const quadros = b.readUInt16LE(4);
  return Array.from({ length: quadros }, (_, i) => {
    const largura = b.readUInt8(6 + i * 16);
    // 0 no campo de largura significa 256 no formato ICO
    return largura === 0 ? 256 : largura;
  });
}

describe("arquivos de ícone", () => {
  it("o favicon.ico traz os três tamanhos, e não um só reamostrado", () => {
    // Um ICO com um quadro de 48 obriga o navegador a reduzir 48 para 16, e
    // reduzir monolinha é exatamente o que produz o borrão cinza na aba.
    expect(tamanhosDoIco(ler("src/app/favicon.ico")).sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it("o maskable é um arquivo próprio, não uma cópia do ícone quadrado", () => {
    const quadrado = sha1(ler("public/app-icon-512.png"));
    const maskable = sha1(ler("public/app-icon-maskable-512.png"));
    expect(
      maskable,
      "app-icon-maskable-512.png é idêntico ao app-icon-512.png: a marca não " +
        "tem a zona segura de 20% e a máscara do Android vai mordê-la",
    ).not.toBe(quadrado);
  });

  it("apple-touch-icon e maskable não têm canal alfa", () => {
    // Estrutural em vez de prometido: sem canal alfa não existe pixel
    // transparente para o iOS pintar de preto nem buraco no ladrilho do
    // Android. Se alguém regravar com alfa, este teste cai.
    for (const arquivo of ["public/apple-touch-icon.png", "public/app-icon-maskable-512.png"]) {
      expect(cabecalhoPng(ler(arquivo)).tipoDeCor, `${arquivo} precisa ser RGB sem alfa`).toBe(2);
    }
  });

  it("cada PNG tem o tamanho que o manifesto e o layout anunciam", () => {
    const esperado: Array<[string, number]> = [
      ["public/app-icon-192.png", 192],
      ["public/app-icon-512.png", 512],
      ["public/app-icon-maskable-512.png", 512],
      ["public/apple-touch-icon.png", 180],
    ];
    for (const [arquivo, lado] of esperado) {
      const { largura, altura } = cabecalhoPng(ler(arquivo));
      expect({ arquivo, largura, altura }).toEqual({ arquivo, largura: lado, altura: lado });
    }
  });

  it("o favicon vetorial se adapta ao tema da aba", () => {
    // A aba escura do Chrome derruba o acento do produto para ~2,5:1. O
    // `accent-lift` do design system existe para esse caso; sem a media query
    // o ícone some no escuro.
    const svg = ler("src/app/icon.svg").toString("utf8");
    expect(svg).toContain("prefers-color-scheme:dark");
    expect(svg).toContain("#CDA8F0");
  });
});
