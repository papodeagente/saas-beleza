/**
 * Gera os SVGs de todos os ícones a partir de UMA fonte: `brand-mark.ts`.
 *
 *   npx tsx scripts/gerar-icones.ts
 *
 * POR QUE ISTO EXISTE. Os ícones anteriores foram desenhados à mão uma vez e
 * copiados entre arquivos. O resultado: o `app-icon-maskable-512.png` era, byte
 * a byte, uma cópia do `app-icon-512.png` — zona segura zero, máscara do
 * Android mordendo a marca — e ninguém percebeu por meses. Toda decisão de
 * enquadramento mora aqui, num lugar só, comentada.
 *
 * O QUE ESTE SCRIPT NÃO FAZ: rasterizar. O projeto não tem rasterizador nas
 * dependências (nem sharp, nem playwright). Depois de rodar aqui, converta os
 * SVGs com qualquer rasterizador e monte o .ico com os TRÊS desenhos separados:
 *
 *   public/app-icon-192.png          <- app-192.svg
 *   public/app-icon-512.png          <- app-512.svg
 *   public/app-icon-maskable-512.png <- app-maskable.svg   (gravar SEM alfa)
 *   public/apple-touch-icon.png      <- apple-180.svg      (gravar SEM alfa)
 *   src/app/favicon.ico              <- ico-16 + ico-32 + ico-48
 *   src/app/icon.svg                 <- icon.svg (cópia direta)
 *
 * `src/app/icones.test.ts` confere os invariantes que já quebraram antes.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARCA_ALTURA,
  MARCA_CENTROIDE_X,
  MARCA_CENTROIDE_Y,
  MARCA_CORPO,
  MARCA_LARGURA,
  MARCA_PONTOS,
} from "../src/components/brand-mark";

// Tokens do design system (src/app/globals.css). Nenhuma cor nova.
const ACENTO = "#7437B7"; // --color-accent
const LIFT = "#CDA8F0"; // --color-accent-lift
const PAPEL = "#F8F6FB"; // --color-surface
const NOITE = "#2D203B"; // --color-ink
const MARCA_DE = "#8744CD"; // --color-brand-from
const MARCA_ATE = "#622A9F"; // --color-brand-to

/**
 * RAMPA DE PESO ÓPTICO.
 *
 * A geometria nunca muda; só a espessura. A monolinha da marca tem 22px numa
 * caixa de 478 (4,6% da largura). A 16px isso vira 0,74 pixel e some. Dar
 * `stroke` a um path preenchido dilata a forma sem redesenhá-la, e a dose vai
 * por tamanho, como fonte tem tamanho óptico.
 */
const PESO = {
  /** 48px e acima: a marca como ela é. */
  grande: 0,
  /** 32px: compensação leve. É o que a maioria vê — 16 CSS px numa tela retina. */
  medio: 8,
  /** 16px: compensação pesada. Sem ela sobra um borrão cinza. */
  pequeno: 30,
};

/**
 * Marca escalada e centrada pelo CENTROIDE DE TINTA.
 *
 * Centrar pela caixa é o erro que estava no ícone antigo: a marca é pesada à
 * direita e ao alto (a unha ocupa o canto direito, a cauda de baixo é fina),
 * então a caixa deixa um buraco no canto inferior esquerdo e sufoca a base.
 */
function marca(cor: string, engorda: number, ocupa: number, lado: number) {
  const escala = (lado * ocupa) / MARCA_ALTURA;
  const tx = lado / 2 - MARCA_LARGURA * escala * MARCA_CENTROIDE_X;
  const ty = lado / 2 - MARCA_ALTURA * escala * MARCA_CENTROIDE_Y;
  // Ponto é forma cheia e compacta: dilatá-lo tanto quanto a linha funde os
  // nove num tijolo. 1/2,8 foi a razão que os manteve separados a 16px.
  const engordaPonto = Math.round((engorda / 2.8) * 10) / 10;
  return (
    `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${escala.toFixed(6)})">` +
    `<path fill="${cor}" fill-rule="evenodd" stroke="${cor}" stroke-width="${engorda}" ` +
    `stroke-linejoin="round" d="${MARCA_CORPO}"/>` +
    `<path fill="${cor}" stroke="${cor}" stroke-width="${engordaPonto}" d="${MARCA_PONTOS}"/>` +
    `</g>`
  );
}

/**
 * ÍCONE DE NAVEGADOR: marca ROXA sobre o papel do produto.
 *
 * Manter a marca roxa é o que responde "não está fiel à logo" — o erro do
 * ícone antigo não foi ter fundo, foi INVERTER a marca para branco. E o fundo
 * não é enfeite: este site declara themeColor #8744CD, e o Safari tinge a
 * própria barra de abas com ele; roxo sobre transparente ali mede 1,4:1 e
 * desaparece.
 */
function chip(lado: number, engorda: number, tema: boolean, ocupa = 0.8) {
  const raio = (lado * 0.125).toFixed(2);
  const estilo = tema
    ? `<style>svg{--f:${PAPEL};--t:${ACENTO}}` +
      `@media(prefers-color-scheme:dark){svg{--f:${NOITE};--t:${LIFT}}}</style>`
    : "";
  const fundo = tema ? "var(--f)" : PAPEL;
  const tinta = tema ? "var(--t)" : ACENTO;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ` +
    `width="${lado}" height="${lado}">${estilo}` +
    `<rect width="${lado}" height="${lado}" rx="${raio}" fill="${fundo}"/>` +
    marca(tinta, engorda, ocupa, lado) +
    `</svg>`
  );
}

/**
 * ÍCONE DE SISTEMA: marca BRANCA sobre o gradiente da marca.
 *
 * Aqui a inversão é legítima e oficial — existe lockup branco no material da
 * marca. O ícone cai sobre papel de parede, o iOS proíbe transparência, e a cor
 * é o ativo de reconhecimento na tela de início.
 */
function ladrilho(lado: number, ocupa: number, raio: number) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" ` +
    `width="${lado}" height="${lado}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">` +
    `<stop offset="0" stop-color="${MARCA_DE}"/>` +
    `<stop offset="1" stop-color="${MARCA_ATE}"/></linearGradient></defs>` +
    `<rect width="${lado}" height="${lado}" rx="${(lado * raio).toFixed(1)}" fill="url(#g)"/>` +
    marca("#FFFFFF", 0, ocupa, lado) +
    `</svg>`
  );
}

const ARQUIVOS: Record<string, string> = {
  // O SVG não sabe em que tamanho vai ser rasterizado, então carrega o peso de
  // 32px, que é a rasterização mais comum.
  "icon.svg": chip(32, PESO.medio, true),
  "ico-16.svg": chip(16, PESO.pequeno, false),
  "ico-32.svg": chip(32, PESO.medio, false),
  "ico-48.svg": chip(48, PESO.grande, false),
  // Squircle da Apple: 40/180 = 0,2237.
  "app-192.svg": ladrilho(192, 0.62, 0.2237),
  "app-512.svg": ladrilho(512, 0.62, 0.2237),
  // Maskable: 20% de zona segura de cada lado e NENHUM canto próprio — quem
  // arredonda é o Android, e canto sob canto vira casca dupla.
  "app-maskable.svg": ladrilho(512, 0.46, 0),
  // iOS aplica o squircle dele pelo mesmo motivo.
  "apple-180.svg": ladrilho(180, 0.6, 0),
};

const destino = join(process.cwd(), "scripts", "icones-gerados");
mkdirSync(destino, { recursive: true });
for (const [nome, svg] of Object.entries(ARQUIVOS)) {
  writeFileSync(join(destino, nome), svg);
  console.log(`  ${nome} — ${svg.length} bytes`);
}
console.log(`\nSVGs em ${destino}. Rasterize e monte o .ico conforme o cabeçalho deste arquivo.`);
