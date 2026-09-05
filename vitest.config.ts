import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Testes de integração falam com o Postgres real (mesmo banco do dev).
config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // O teste de booking cria e limpa tenants próprios; rodar em paralelo
    // com outro arquivo que use o mesmo banco causaria interferência.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // "server-only" só existe para o bundler do Next; em Node ele lança.
      "server-only": resolve(__dirname, "./test/server-only-stub.ts"),
    },
  },
});
