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
