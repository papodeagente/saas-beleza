import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar — Lumina" };

export default async function LoginPage() {
  if (await getSession()) redirect("/hoje");

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-[360px]">
        <div className="mb-8">
          {/* Primeiro contato com a marca: o quadrado sozinho não diz o nome do produto. */}
          <p className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-control bg-accent text-label font-semibold text-white"
            >
              L
            </span>
            <span className="font-display text-title text-ink">Lumina</span>
          </p>
          <h1 className="mt-6 font-display text-display text-ink">Bom te ver de novo</h1>
          <p className="mt-1.5 text-body text-ink-secondary">
            Entre para acompanhar a operação da sua clínica.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
