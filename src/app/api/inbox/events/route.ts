import IORedis from "ioredis";
import { getSession } from "@/server/auth";
import { inboxChannel } from "@/server/services/inbox-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

/** Canal autenticado de eventos do Inbox (Server-Sent Events). */
export async function GET(request: Request) {
  const ctx = await getSession();
  if (!ctx || ctx.role === "professional") {
    return new Response("Não autorizado", { status: 401 });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return new Response("Tempo real indisponível", { status: 503 });

  let subscriber: IORedis | null = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    const current = subscriber;
    subscriber = null;
    if (current) {
      current.removeAllListeners();
      await current.quit().catch(() => current.disconnect());
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      subscriber!.on("message", (_channel, message) => {
        send(`data: ${message}\n\n`);
      });
      subscriber!.on("error", (error) => {
        console.warn("[inbox realtime] conexão de leitura:", error.message);
      });

      try {
        await subscriber!.subscribe(inboxChannel(ctx.organizationId));
        // Confirma a conexão e faz o cliente sincronizar uma vez, fechando a
        // pequena janela entre o HTML inicial e a assinatura do canal.
        send(`event: ready\ndata: {}\n\n`);
        heartbeat = setInterval(() => send(`: heartbeat\n\n`), 20_000);
      } catch (error) {
        console.error("[inbox realtime] assinatura falhou:", error);
        controller.error(error);
        await close();
      }

      request.signal.addEventListener("abort", () => void close(), { once: true });
    },
    cancel() {
      return close();
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
