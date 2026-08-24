import { cn } from "@/lib/utils";

/** Símbolo vetorial da Agenda de Unha. Mantém proporção, cor única e área de respiro. */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Agenda de Unha"
      className={cn("shrink-0", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 11h27a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H16a9 9 0 0 1-9-9V20a9 9 0 0 1 7-8.7Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M17 6v12M40 6v12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      {[18, 28, 38].flatMap((x) => [28, 38].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="currentColor" />))}
      <path d="M31 50c8.5-12.7 15.6-18.9 21.1-18.4 3.9.4 5.7 3.2 5.1 7.1-.8 5.2-7.6 8.5-15.5 8.3" fill="var(--brand-nail-fill, currentColor)" />
      <path d="M32 58 47 43" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M45.5 34.5c3.6-2.7 7-3.5 9.5-1.7" stroke="white" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
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
