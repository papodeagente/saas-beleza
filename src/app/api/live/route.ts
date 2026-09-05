export const dynamic = "force-dynamic";

/**
 * Sinal de vida do processo. Zero I/O de propósito.
 *
 * Liveness não é readiness: se o banco piscar, quem tem que reagir é o
 * monitoramento, não o orquestrador matando o contêiner. A checagem que
 * inclui o banco vive em /api/health.
 */
export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}
