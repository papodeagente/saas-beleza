import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Camada de modelo.
 *
 * O agente fala com dois provedores possíveis — Claude e OpenAI — atrás de um
 * formato neutro de conversa. Isso existe pelo mesmo motivo que no
 * entur-os-crm: a escolha de modelo é do cliente, e trocar de modelo não pode
 * significar reescrever o orquestrador nem as ferramentas.
 *
 * Restrição herdada e não negociável do lado OpenAI: modelos de raciocínio
 * (família gpt-5.x, o-series) recusam function tools em /v1/chat/completions.
 * Só entram no catálogo modelos comprovadamente compatíveis com tools.
 */

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type LlmItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type LlmTurn = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type CompleteArgs = {
  model: string;
  system: string;
  messages: LlmItem[];
  tools: AgentToolDefinition[];
  maxOutputTokens: number;
  temperature: number;
  effort?: "low" | "medium" | "high";
  extendedThinking?: boolean;
};

export type ModelInfo = {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  note?: string;
};

/**
 * Catálogo mostrado na tela de configuração. Só entra modelo que aceita
 * function tools — o resto quebraria o agente em produção, não no teste.
 */
export const AGENT_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", note: "Mais capaz" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", note: "Equilíbrio" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", note: "Mais rápido e barato" },
  { id: "chat-latest", label: "OpenAI chat-latest", provider: "openai" },
  { id: "gpt-4.1", label: "OpenAI GPT-4.1", provider: "openai" },
  { id: "gpt-4.1-mini", label: "OpenAI GPT-4.1 mini", provider: "openai", note: "Mais barato" },
];

export const DEFAULT_MODEL = "claude-opus-5";

export function providerOf(model: string): "anthropic" | "openai" {
  const known = AGENT_MODELS.find((m) => m.id === model);
  if (known) return known.provider;
  return model.startsWith("claude") ? "anthropic" : "openai";
}

/**
 * `gpt-5-chat-latest` foi descontinuado pela OpenAI e o erro que ela devolve
 * sugere problema de chave, o que manda quem investiga para o lado errado.
 * O remap em runtime evita que uma configuração antiga derrube o agente.
 */
export function normalizeModel(model: string | null | undefined): string {
  const m = (model || "").trim();
  if (!m) return DEFAULT_MODEL;
  if (m === "gpt-5-chat-latest") return "chat-latest";
  if (/^(gpt-5|o[1-9])/.test(m) && !/-(chat-latest|codex)$/.test(m)) {
    // Modelo de raciocínio configurado por engano: cai para um que aceita tools.
    return "chat-latest";
  }
  return m;
}

export class LlmConfigError extends Error {}

// ── Claude ────────────────────────────────────────────────────────────────

function anthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmConfigError("ANTHROPIC_API_KEY não configurada.");
  return new Anthropic({ apiKey });
}

async function completeAnthropic(args: CompleteArgs): Promise<LlmTurn> {
  const client = anthropicClient();

  const messages: Anthropic.MessageParam[] = [];
  for (const item of args.messages) {
    if (item.role === "user") {
      messages.push({ role: "user", content: item.content });
    } else if (item.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (item.content) blocks.push({ type: "text", text: item.content });
      for (const call of item.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
    } else {
      // Resultado de ferramenta volta como mensagem do usuário, que é onde a
      // API espera encontrá-lo.
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: item.toolCallId, content: item.content }],
      });
    }
  }

  const response = await client.messages.create({
    model: args.model,
    max_tokens: args.extendedThinking ? Math.max(args.maxOutputTokens, 8000) : args.maxOutputTokens,
    system: args.system,
    messages,
    tools: args.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    })),
    ...(args.extendedThinking
      ? { thinking: { type: "adaptive" as const }, output_config: { effort: args.effort ?? "low" } }
      : {}),
  });

  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
  }

  return {
    text: text.trim(),
    toolCalls,
    stopReason: response.stop_reason ?? "end_turn",
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// ── OpenAI ────────────────────────────────────────────────────────────────

async function completeOpenAi(args: CompleteArgs): Promise<LlmTurn> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LlmConfigError("OPENAI_API_KEY não configurada.");

  const messages: Record<string, unknown>[] = [{ role: "system", content: args.system }];
  for (const item of args.messages) {
    if (item.role === "user") messages.push({ role: "user", content: item.content });
    else if (item.role === "assistant") {
      messages.push({
        role: "assistant",
        content: item.content || null,
        tool_calls: item.toolCalls?.length
          ? item.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.input) },
            }))
          : undefined,
      });
    } else {
      messages.push({ role: "tool", tool_call_id: item.toolCallId, content: item.content });
    }
  }

  /**
   * Duas recusas medidas na API da OpenAI (2026-08-22), que o catálogo não
   * anuncia: `chat-latest` devolve 400 para `max_tokens` — quer
   * `max_completion_tokens` — e só aceita temperatura 1. Como a temperatura é
   * configurável por conta e nasce em 0,7, mandar o campo derrubava todo turno
   * do agente justamente no modelo que é o padrão de quem só tem chave OpenAI.
   * `max_completion_tokens` funciona também nos gpt-4.1, então vale para todos.
   */
  const acceptsTemperature = !/^(chat-latest|gpt-5|o[1-9])/.test(args.model);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      messages,
      max_completion_tokens: args.maxOutputTokens,
      ...(acceptsTemperature ? { temperature: args.temperature } : {}),
      tools: args.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    }),
  });

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`OpenAI ${res.status}: ${body}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0];
  const rawCalls = choice?.message?.tool_calls ?? [];

  return {
    text: String(choice?.message?.content ?? "").trim(),
    toolCalls: rawCalls.map((call: any) => ({
      id: call.id,
      name: call.function?.name,
      input: safeParse(call.function?.arguments),
    })),
    stopReason: choice?.finish_reason ?? "stop",
    usage: {
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
    },
  };
}

function safeParse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function complete(args: CompleteArgs): Promise<LlmTurn> {
  const model = normalizeModel(args.model);
  return providerOf(model) === "anthropic"
    ? completeAnthropic({ ...args, model })
    : completeOpenAi({ ...args, model });
}

/** A chave existe para o provedor deste modelo? Usado pela tela de configuração. */
export function hasApiKeyFor(model: string): boolean {
  return providerOf(normalizeModel(model)) === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}
