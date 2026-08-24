import { cn } from "@/lib/utils";
import {
  MARCA_ALTURA,
  MARCA_CENTROIDE_X,
  MARCA_CENTROIDE_Y,
  MARCA_CORPO,
  MARCA_LARGURA,
  MARCA_PONTOS,
} from "./brand-mark";

/**
 * Símbolo vetorial da Agenda de Unha.
 *
 * O desenho vem de `brand-mark.ts`, que é o contorno extraído do arquivo
 * oficial — não um desenho de memória. O que estava aqui antes tinha quatro
 * erros e duas invenções: o canto superior esquerdo do calendário fechava com
 * um arco de volta ao ponto inicial e ficava pinçado; os pontos eram seis numa
 * grade 3x2 em vez dos nove em pirâmide 4-3-2 (a quarta coluna some nas linhas
 * de baixo justamente porque a unha ocupa aquele canto, e é isso que faz o
 * calendário e a unha lerem como um desenho só); faltava o trilho superior; e a
 * unha era uma meia-lua com um palito saindo da ponta.
 *
 * As invenções que saíram: um brilho `stroke="white"` a 55% de opacidade sobre
 * a unha, que sobre fundo claro virava sujeira, e a variável
 * `--brand-nail-fill`, que existia só para remendar o desenho errado. A marca é
 * monolinha e de cor única — por isso `currentColor` em tudo.
 *
 * A caixa é quadrada e a marca é centrada pelo CENTROIDE DE TINTA. Ver a
 * explicação em `brand-mark.ts`: centrar pela caixa deixa a marca visivelmente
 * torta.
 */
export function BrandIcon({ className }: { className?: string }) {
  const ocupa = 0.94;
  const escala = (100 * ocupa) / MARCA_ALTURA;
  const tx = 50 - MARCA_LARGURA * escala * MARCA_CENTROIDE_X;
  const ty = 50 - MARCA_ALTURA * escala * MARCA_CENTROIDE_Y;
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="Agenda de Unha"
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={`translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${escala.toFixed(6)})`}>
        <path d={MARCA_CORPO} fill="currentColor" fillRule="evenodd" />
        <path d={MARCA_PONTOS} fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * O lockup da tela é o RECORTE da marca, sem a assinatura.
 *
 * O arquivo oficial (2172x724) traz "GESTÃO INTELIGENTE PARA MANICURES" numa
 * faixa de 30px de altura. Em qualquer slot de interface que existe neste
 * produto — barra de 56px, faixa do login, rodapé da landing — essa faixa cai
 * para 2 ou 3 pixels e vira um risco sujo debaixo do nome. Não é questão de
 * escolher um tamanho maior: para a assinatura sair com 7px de caixa alta o
 * PNG inteiro precisaria de ~250px de altura, que nenhum desses lugares tem.
 *
 * Os recortes `-marca` foram gerados por script (Pillow) a partir dos oficiais:
 * apaga-se a assinatura à direita do traço da unha e recorta-se colado na
 * tinta. Colar na tinta é o segundo ganho: o arquivo original tinha 27% de
 * transparente em volta, então o nome renderizava a 30px dentro de uma caixa de
 * 48px. Agora a caixa É a marca.
 *
 * A assinatura continua existindo onde ela cabe e é lida: no rodapé da landing,
 * escrita como texto de verdade logo abaixo desta logo. Os PNGs oficiais
 * completos seguem em /public/brand como mestres para material impresso.
 */
const ARQUIVOS = {
  color: { src: "/brand/agenda-de-unha-color-marca.png", width: 709, height: 240 },
  white: { src: "/brand/agenda-de-unha-white-marca.png", width: 658, height: 240 },
} as const;

export function BrandLogo({
  className,
  compact = false,
  variant = "color",
}: {
  className?: string;
  /** Uso em chrome (barra, faixa de login, coluna do agendamento). */
  compact?: boolean;
  variant?: "color" | "white";
}) {
  const arquivo = ARQUIVOS[variant];
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} aria-label="Agenda de Unha">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={arquivo.src}
        alt="Agenda de Unha"
        width={arquivo.width}
        height={arquivo.height}
        className={cn("block w-auto object-contain", compact ? "h-10" : "h-14")}
      />
    </span>
  );
}
