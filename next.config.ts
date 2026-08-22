import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagem de produção enxuta: o Docker copia só o bundle standalone
  output: "standalone",
};

export default nextConfig;
