/**
 * Série temporal em SVG puro. Sem biblioteca de gráfico: uma linha e uma área
 * não justificam 40 KB de dependência, e o desenho aqui é determinístico —
 * mesmo dado, mesmo traço, no servidor e no cliente.
 */
export function Sparkline({
  points,
  height = 120,
  className,
  label,
}: {
  points: number[];
  height?: number;
  className?: string;
  label: string;
}) {
  if (points.length < 2) return null;

  const width = 100;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  // Deixa 8% de folga em cima e embaixo para o traço não encostar na borda.
  const y = (value: number) => 92 - ((value - min) / span) * 84;
  const x = (index: number) => (index / (points.length - 1)) * width;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p).toFixed(2)}`).join(" ");
  const area = `${line} L ${width} 100 L 0 100 Z`;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      style={{ height }}
      className={className}
    >
      <defs>
        <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkline-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
