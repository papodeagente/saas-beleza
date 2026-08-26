import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agenda de Unha",
    short_name: "Agenda de Unha",
    description: "Gestão inteligente para manicures.",
    start_url: "/",
    display: "standalone",
    background_color: "#FCFAFF",
    theme_color: "#8744CD",
    lang: "pt-BR",
    /**
     * Atalhos da tela de início. O primeiro é o diretório: quem instala pelo
     * marketplace instala para PROCURAR manicure, não para operar um salão —
     * e o `start_url` "/" leva à landing.
     */
    shortcuts: [
      { name: "Buscar manicure", short_name: "Buscar", url: "/manicures" },
      { name: "Minha agenda de hoje", short_name: "Hoje", url: "/hoje" },
      { name: "Conversas", short_name: "Inbox", url: "/inbox" },
    ],
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
