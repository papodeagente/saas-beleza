import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * A escala tipográfica do produto usa o namespace `text-*` (idiomático no
 * Tailwind v4, onde ela nasce de `--text-*`). Sem avisar o tailwind-merge, ele
 * confunde `text-label` com uma classe de COR e descarta a cor que vier junto:
 * `bg-accent text-white text-label` perdia o `text-white` e o botão primário
 * ficava com texto escuro sobre bordeaux (2:1 de contraste).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "entity",
            "title",
            "metric",
            "card",
            "body",
            "label",
            "caption",
            "meta",
            "section",
            // Escala da landing pública. Esquecer um nome aqui não quebra
            // build, tipo nem lint: a manchete simplesmente renderiza em 14px,
            // ou perde a cor, dependendo da ordem das classes.
            "hero",
            "section-title",
            "lede",
            "stat",
            "quote",
            "eyebrow",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
