import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Anexo do inbox viaja como base64 dentro da server action; o padrão de 1 MB
    // barraria qualquer foto de celular.
    serverActions: { bodySizeLimit: "12mb" },
  },
  // Imagem de produção enxuta: o Docker copia só o bundle standalone
  output: "standalone",
};

export default nextConfig;
