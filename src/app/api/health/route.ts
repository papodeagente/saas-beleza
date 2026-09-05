import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Sinal de saúde do contêiner.
 *
 * Responde 200 quando o servidor está de pé E o banco responde — é o par que
 * importa: um processo vivo sem banco não serve nenhuma tela. Sem esta rota o
 * orquestrador não tem como distinguir "no ar" de "morto" e marca a aplicação
 * como caída mesmo servindo tráfego.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("[health] banco indisponível:", error);
    return NextResponse.json({ status: "degraded", database: false }, { status: 503 });
  }
}
