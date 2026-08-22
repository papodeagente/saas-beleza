/**
 * Cores de identidade (profissional) são cadastradas livremente e não passam
 * por revisão de contraste. Estas funções garantem que qualquer valor
 * cadastrado renderize legível, escurecendo o texto na direção da tinta até
 * cruzar 4.5:1 sobre o próprio tom claro.
 */

const INK: RGB = { r: 0x23, g: 0x1f, b: 0x1d };
const WHITE: RGB = { r: 255, g: 255, b: 255 };

type RGB = { r: number; g: number; b: number };

function parseHex(value: string): RGB | null {
  const hex = value.trim().replace("#", "");
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  if (hex.length !== 6) return null;
  const n = Number.parseInt(hex, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  };
}

function luminance({ r, g, b }: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const css = ({ r, g, b }: RGB) => `rgb(${r}, ${g}, ${b})`;

/**
 * Par fundo/texto para um marcador de identidade: fundo é a cor a 12% sobre
 * branco, texto é a cor escurecida o suficiente para ler sobre ele.
 */
export function identityTint(
  color: string,
  /** Quanto branco entra no fundo. Superfície grande pede tinta mais leve para
      o texto de apoio continuar legível em cima dela. */
  whiteness = 0.88,
): { background: string; foreground: string } {
  const base = parseHex(color);
  if (!base) return { background: "var(--color-accent-soft)", foreground: "var(--color-accent)" };

  const background = mix(base, WHITE, whiteness);
  let foreground = base;
  for (let t = 0; t <= 1 && contrastRatio(foreground, background) < 4.5; t += 0.05) {
    foreground = mix(base, INK, t);
  }
  return { background: css(background), foreground: css(foreground) };
}
