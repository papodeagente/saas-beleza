import { NextResponse } from "next/server";
import { getPublicLogo } from "@/server/services/public-booking-service";

/**
 * Serve a foto do estabelecimento na página pública de agendamento.
 *
 * Diferente de `/api/foto-perfil` (a foto de UM contato, restrita à sessão de
 * UMA clínica), esta é pública de propósito: é a mesma imagem que aparece
 * pra qualquer cliente que abrir o link de agendar. `Cache-Control: public`
 * é seguro aqui.
 *
 * `logoVersion` é o `?v=` que a página manda no `src` — sobe a cada troca de
 * foto, então um navegador com a capa antiga em cache pede de novo assim que
 * a dona troca a imagem, em vez de ficar preso ao `ETag` de uma versão velha.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const logo = await getPublicLogo(slug);
  if (!logo) return new NextResponse(null, { status: 404 });

  const etag = `W/"${logo.version}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.length),
      ETag: etag,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
