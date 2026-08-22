import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth";

export async function POST(request: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/entrar", request.url), { status: 303 });
}
