import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth";

export async function POST(request: Request) {
  await destroySession();

  // `request.url` é o endereço que o servidor Next.js enxerga por dentro do
  // contêiner (atrás do proxy do Coolify isso é algo como `0.0.0.0:3000` ou
  // `localhost:3000`, não o domínio público) — usá-lo como base mandava todo
  // mundo de volta para um endereço interno inválido depois do logoff. Mesma
  // solução já usada em `admin/pagamentos` para montar uma URL que o mundo
  // externo enxerga: `APP_URL`/`NEXT_PUBLIC_APP_URL` quando configurado, e o
  // host que o proxy repassou como fallback.
  const configuredBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(
    /\/+$/,
    "",
  );
  let origin = configuredBase;
  if (!origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  }

  // Depois de deslogar, volta para o início do site — não para a tela de
  // login (era esse o outro problema: quem saía caía em `/entrar`).
  return NextResponse.redirect(new URL("/", origin), { status: 303 });
}
