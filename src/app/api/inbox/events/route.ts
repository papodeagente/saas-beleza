import { getSession } from "@/server/auth";
import { subscribeInbox } from "@/server/services/inbox-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

/**
 * Canal autenticado de eventos do Inbox (Server-Sent Events).
 *
 * A rota não sabe de onde o evento vem: `subscribeInbox` entrega o Redis
 * compartilhado quando há REDIS_URL e o barramento em processo quando não há.
 * Antes, esta rota abria uma conexão IORedis POR ABA e respondia 503 sem
 * Redis — vinte telas abertas eram vinte conexões, e o ambiente sem Redis
 * ficava sem tempo real nenhum, em silêncio.
 */
export async function GET(request: Request) {
  const ctx = await getSession();
  if (!ctx || ctx.role === "professional") {
    return new Response("Não autorizado", { status: 401 });
  }

  if (!process.env.REDIS_URL && process.env.NODE_ENV === "production") {
    // Em produção a ausência de Redis é defeito de configuração, não modo de
    // operação: sem ela o tempo real não atravessa instâncias e degrada para
    // a varredura de trinta segundos sem ninguém perceber.
    console.error("[inbox realtime] REDIS_URL ausente em produção — tempo real degradado.");
  }

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      unsubscribe = subscribeInbox(ctx.organizationId, (payload) => send(`data: ${payload}\n\n`));

      // Confirma a conexão e faz o cliente sincronizar uma vez, fechando a
      // pequena janela entre o HTML inicial e a assinatura do canal.
      send(`event: ready\ndata: {}\n\n`);
      heartbeat = setInterval(() => send(`: heartbeat\n\n`), 20_000);

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
