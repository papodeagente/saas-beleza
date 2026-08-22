import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "./llm";

/**
 * O corpo que sai para a OpenAI. Cada campo aqui é uma recusa real da API
 * medida com chave de verdade: `max_tokens` e temperatura diferente de 1 são
 * 400 no `chat-latest`, que é o modelo padrão de quem só tem chave OpenAI.
 */
function bodyEnviado(): Record<string, unknown> {
  const chamada = vi.mocked(globalThis.fetch).mock.calls[0];
  return JSON.parse(String((chamada[1] as RequestInit).body));
}

function respostaFake() {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    }),
  } as unknown as Response;
}

const pedido = {
  system: "seja breve",
  messages: [{ role: "user" as const, content: "oi" }],
  tools: [],
  maxOutputTokens: 600,
  temperature: 0.7,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("complete (OpenAI)", () => {
  it("no chat-latest manda max_completion_tokens e omite a temperatura", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-teste");
    vi.stubGlobal("fetch", vi.fn(async () => respostaFake()));

    // Configuração antiga: o modelo descontinuado vira chat-latest em runtime.
    await complete({ ...pedido, model: "gpt-5-chat-latest" });

    const body = bodyEnviado();
    expect(body.model).toBe("chat-latest");
    expect(body.max_completion_tokens).toBe(600);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  it("no gpt-4.1 mantém a temperatura escolhida pela conta", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-teste");
    vi.stubGlobal("fetch", vi.fn(async () => respostaFake()));

    await complete({ ...pedido, model: "gpt-4.1" });

    const body = bodyEnviado();
    expect(body.model).toBe("gpt-4.1");
    expect(body.max_completion_tokens).toBe(600);
    expect(body.temperature).toBe(0.7);
  });
});
