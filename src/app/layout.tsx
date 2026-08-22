import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const sans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
  // Sem `weight`: a fonte carrega variável, que é o que permite os pesos
  // intermediários da escala (450 no corpo, 550 no display).
});

// Voz do produto — usada com contenção (saudação, empty states, booking público).
// Sem os pesos declarados a Fraunces cai em 400 e lê como serifada de livro.
const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  // Fonte variável: com `axes` declarado o peso precisa ficar variável (o
  // build quebra com uma lista fixa) — e é o que permite o 550 do display.
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "Lumina",
    template: "%s · Lumina",
  },
  description: "O sistema operacional do seu negócio de estética.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${display.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-line)",
              color: "var(--color-ink)",
              boxShadow: "var(--shadow-overlay)",
              borderRadius: "10px",
              fontSize: "13px",
            },
          }}
        />
      </body>
    </html>
  );
}
