import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { getPictureBytes } from "@/server/services/profile-picture-service";

/**
 * Serve a foto de perfil guardada.
 *
 * O `organizationId` sai da SESSÃO, nunca do endereço. É o que impede alguém de
 * ler a foto de um contato de outra clínica trocando o JID na URL — o mesmo
 * princípio que vale para o resto do produto, aplicado a uma rota que parece
 * inofensiva por servir só uma imagem.
 *
 * O JID vai em parâmetro de busca e não em segmento de caminho porque ele
 * contém `@` e, em grupo, um sufixo `@g.us`: como segmento ele obrigaria a
 * codificar e decodificar em dois lugares, e um erro nisso viraria avatar
 * quebrado silencioso.
 */
export async function GET(request: Request) {
  const ctx = await getSession();
  if (!ctx) return new NextResponse(null, { status: 401 });

  const jid = new URL(request.url).searchParams.get("jid");
  if (!jid) return new NextResponse(null, { status: 400 });

  const foto = await getPictureBytes(ctx.organizationId, jid);
  if (!foto) return new NextResponse(null, { status: 404 });

  // O ETag é a data da busca: quando o serviço regrava a foto, o navegador
  // percebe. Enquanto não regravar, ele nem refaz o pedido.
  const etag = `W/"${foto.fetchedAt.getTime()}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(foto.bytes), {
    headers: {
      "Content-Type": foto.mime,
      "Content-Length": String(foto.bytes.length),
      ETag: etag,
      // `private`: é a foto de uma cliente de UMA clínica. Cache compartilhado
      // (proxy, CDN) não pode guardar isto.
      "Cache-Control": "private, max-age=86400, must-revalidate",
    },
  });
}
