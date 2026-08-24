import type { Metadata, Viewport } from "next";
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Geométrica e arredondada, na linha da referência aprovada.
const sans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});
const brand = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "Agenda de Unha",
  title: {
    default: "Agenda de Unha",
    template: "%s · Agenda de Unha",
  },
  description: "Gestão inteligente para manicures.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Agenda de Unha",
  },
  icons: {
    // Sem entrada para o /favicon.ico aqui: `src/app/favicon.ico` é convenção
    // de arquivo do App Router e o Next já emite o <link> dele sozinho, com
    // hash de conteúdo. Declarar de novo produzia duas tags para o mesmo
    // arquivo, uma delas anunciando tamanhos errados.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#8744CD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${brand.variable} h-full`}>
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
              borderRadius: "14px",
              fontSize: "13px",
            },
          }}
        />
      </body>
    </html>
  );
}
